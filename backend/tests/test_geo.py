import numpy as np
import pytest
from shapely.geometry import Polygon, box

from aegis.geo.aoi import AOI, AOIValidationError, geodesic_area_km2, utm_epsg_for
from aegis.geo.grid import Grid
from aegis.geo.raster import colormap_composite, read_geotiff, rgb_composite, rgba_to_web_mercator, write_geotiff
from aegis.geo.vector import clean_mask, mask_to_polygons, remove_small_components, round_coords, to_wgs84


def test_bbox_validation_rejects_bad_order_and_ranges():
    with pytest.raises(AOIValidationError):
        AOI.from_bbox(10, 10, 5, 12)
    with pytest.raises(AOIValidationError):
        AOI.from_bbox(170, 0, 200, 1)  # longitude out of range
    with pytest.raises(AOIValidationError):
        AOI.from_bbox(-179, 0, 179, 1)  # antimeridian-style width
    with pytest.raises(AOIValidationError):
        AOI.from_bbox(0, 85, 1, 86)  # outside UTM domain


def test_geojson_parsing_variants_and_repair():
    poly = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}
    assert AOI.from_geojson(poly).bbox == (0, 0, 1, 1)
    assert AOI.from_geojson({"type": "Feature", "geometry": poly, "properties": {}}).bbox == (0, 0, 1, 1)
    bowtie = {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}
    assert AOI.from_geojson(bowtie).geometry.is_valid
    with pytest.raises(AOIValidationError):
        AOI.from_geojson({"type": "Point", "coordinates": [0, 0]})
    with pytest.raises(AOIValidationError):
        AOI.from_geojson({"type": "FeatureCollection", "features": []})
    with pytest.raises(AOIValidationError):
        AOI.from_geojson({"nope": 1})


def test_area_and_size_limits():
    aoi = AOI.from_bbox(0, 0, 0.1, 0.1)
    assert aoi.area_km2 == pytest.approx(123.6, rel=0.01)  # ~11.1 km x 11.1 km at the equator
    aoi.validate_size(0.25, 1500)
    with pytest.raises(AOIValidationError, match="too large"):
        AOI.from_bbox(0, 0, 1, 1).validate_size(0.25, 1500)
    with pytest.raises(AOIValidationError, match="too small"):
        AOI.from_bbox(0, 0, 0.001, 0.001).validate_size(0.25, 1500)
    assert geodesic_area_km2(Polygon()) == 0.0


def test_utm_zones():
    assert utm_epsg_for(67.8, 26.7) == 32642
    assert utm_epsg_for(-118.5, 34.0) == 32611
    assert utm_epsg_for(151.2, -33.9) == 32756


def test_grid_snapping_and_coarsening():
    aoi = AOI.from_bbox(67.72, 26.62, 67.86, 26.76)
    g = Grid.for_aoi(aoi, 20, 10_000_000)
    assert g.crs == "EPSG:32642" and g.resolution == 20
    assert g.transform.c % 20 == 0 and g.transform.f % 20 == 0
    coarse = Grid.for_aoi(aoi, 10, 200_000)
    assert coarse.width * coarse.height <= 200_000 and coarse.resolution % 10 == 0 and coarse.resolution > 10
    mask = g.aoi_mask(aoi)
    assert mask.shape == g.shape and 0.9 < mask.mean() <= 1.0
    minx, miny, maxx, maxy = g.bounds_wgs84()
    assert minx <= 67.72 + 1e-3 and maxx >= 67.86 - 1e-3
    assert Grid.from_dict(g.to_dict()) == g


def test_geotiff_roundtrip(tmp_path):
    g = Grid.for_aoi(AOI.from_bbox(0, 0, 0.05, 0.05), 20, 1_000_000)
    a = np.random.default_rng(0).random(g.shape).astype(np.float32)
    a[0, 0] = np.nan
    p = write_geotiff(tmp_path / "x.tif", {"alpha": a, "beta": a * 2}, g)
    back = read_geotiff(p)
    assert set(back) == {"alpha", "beta"}
    assert np.isnan(back["alpha"][0, 0]) and np.allclose(back["beta"][1:, 1:], a[1:, 1:] * 2)


def test_web_mercator_overlay_corners():
    g = Grid.for_aoi(AOI.from_bbox(10, 45, 10.1, 45.1), 20, 1_000_000)
    rgba = rgb_composite(*(np.full(g.shape, 0.1, np.float32) for _ in range(3)))
    merc, corners = rgba_to_web_mercator(rgba, g)
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = corners
    assert x0 < x1 and y0 > y3 and x2 == x1 and y2 == y3  # TL, TR, BR, BL
    assert 9.9 < x0 < 10.05 and 45.05 < y0 < 45.2
    assert merc.shape[2] == 4 and merc[..., 3].max() == 255


def test_colormap_transparency():
    arr = np.array([[np.nan, 0.1, 0.9]], np.float32)
    rgba = colormap_composite(arr, [(0.0, (0, 0, 0, 0)), (1.0, (255, 0, 0, 255))], transparent_below=0.2)
    assert rgba[0, 0, 3] == 0 and rgba[0, 1, 3] == 0 and rgba[0, 2, 3] > 200


def test_mask_cleaning_and_vectorising():
    m = np.zeros((50, 50), bool)
    m[5:20, 5:20] = True
    m[40, 40] = True  # speckle
    assert remove_small_components(m, 10).sum() == 225
    assert clean_mask(m, 10)[40, 40] == np.False_
    g = Grid.for_aoi(AOI.from_bbox(0, 0, 0.01, 0.01), 20, 1_000_000)
    mm = np.zeros(g.shape, bool)
    mm[2:8, 2:8] = True
    polys = mask_to_polygons(mm, g)
    assert len(polys) == 1 and polys[0].area == pytest.approx(36 * 400, rel=0.05)
    w = to_wgs84(polys[0], g)
    assert 0 <= w.bounds[0] <= 0.01
    rc = round_coords(box(0.1234567891, 0, 1, 1).__geo_interface__, 3)
    assert rc["coordinates"][0][0][0] in (0.123, 1.0)
