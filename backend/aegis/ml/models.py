"""Segmentation networks.

``UNet``             single-stream U-Net used for the learned baselines
                     (S1-only, S2-only and early fusion = channel concatenation).
``GatedFusionUNet``  the improved multi-branch model: separate SAR and optical
                     encoders whose features are merged at every scale by a
                     validity-aware gated fusion block, followed by a shared decoder.

Gated fusion (per scale *s*)::

    g      = sigmoid(conv([f_sar, f_opt, v_sar, v_opt]))          # learned reliance on SAR
    g_eff  = v_sar * (g * v_opt + (1 - v_opt))                    # hard constraints:
                                                                  #   optical invalid -> SAR only
                                                                  #   SAR invalid     -> optical only
    fused  = g_eff * f_sar + (1 - g_eff) * f_opt + v_sar * v_opt * joint([f_sar, f_opt])

``v_*`` are per-pixel validity fractions (cloud/no-data masks average-pooled to scale s).
The finest-scale ``g_eff`` is returned as a *sensor-reliance map* for explainability.
Dropout before the head enables Monte-Carlo dropout uncertainty at inference time.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F
from torch import nn

from aegis.ml.features import S1_CHANNELS, S2_CHANNELS

WIDTHS = (16, 32, 64, 128)


class ConvBlock(nn.Module):
    def __init__(self, cin: int, cout: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(cin, cout, 3, padding=1, bias=False),
            nn.BatchNorm2d(cout),
            nn.ReLU(inplace=True),
            nn.Conv2d(cout, cout, 3, padding=1, bias=False),
            nn.BatchNorm2d(cout),
            nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class Encoder(nn.Module):
    def __init__(self, cin: int, widths: tuple[int, ...] = WIDTHS):
        super().__init__()
        chans = (cin, *widths)
        self.blocks = nn.ModuleList(ConvBlock(chans[i], chans[i + 1]) for i in range(len(widths)))

    def forward(self, x: torch.Tensor) -> list[torch.Tensor]:
        feats = []
        for i, block in enumerate(self.blocks):
            if i > 0:
                x = F.max_pool2d(x, 2)
            x = block(x)
            feats.append(x)
        return feats


class Decoder(nn.Module):
    def __init__(self, widths: tuple[int, ...] = WIDTHS, dropout: float = 0.2):
        super().__init__()
        self.ups = nn.ModuleList(nn.Conv2d(widths[i + 1], widths[i], 1) for i in range(len(widths) - 1))
        self.blocks = nn.ModuleList(ConvBlock(2 * widths[i], widths[i]) for i in range(len(widths) - 1))
        self.dropout = nn.Dropout2d(dropout)
        self.head = nn.Conv2d(widths[0], 1, 1)

    def trunk(self, feats: list[torch.Tensor]) -> torch.Tensor:
        """Decoder features at full resolution, before dropout and the 1x1 head."""
        x = feats[-1]
        for i in reversed(range(len(feats) - 1)):
            x = F.interpolate(x, size=feats[i].shape[-2:], mode="bilinear", align_corners=False)
            x = self.ups[i](x)
            x = self.blocks[i](torch.cat([x, feats[i]], dim=1))
        return x

    def forward(self, feats: list[torch.Tensor]) -> torch.Tensor:
        return self.head(self.dropout(self.trunk(feats)))


class UNet(nn.Module):
    def __init__(self, in_channels: int, widths: tuple[int, ...] = WIDTHS, dropout: float = 0.2):
        super().__init__()
        self.encoder = Encoder(in_channels, widths)
        self.decoder = Decoder(widths, dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.decoder(self.encoder(x))


class GatedFusion(nn.Module):
    def __init__(self, ch: int):
        super().__init__()
        self.gate = nn.Sequential(
            nn.Conv2d(2 * ch + 2, ch, 3, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(ch, 1, 1),
        )
        self.joint = nn.Sequential(nn.Conv2d(2 * ch, ch, 1, bias=False), nn.BatchNorm2d(ch), nn.ReLU(inplace=True))

    def forward(
        self, f_sar: torch.Tensor, f_opt: torch.Tensor, v_sar: torch.Tensor, v_opt: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor]:
        both = torch.cat([f_sar, f_opt], dim=1)
        g = torch.sigmoid(self.gate(torch.cat([both, v_sar, v_opt], dim=1)))
        g_eff = v_sar * (g * v_opt + (1.0 - v_opt))
        fused = g_eff * f_sar + (1.0 - g_eff) * f_opt + (v_sar * v_opt) * self.joint(both)
        return fused, g_eff


class GatedFusionUNet(nn.Module):
    def __init__(
        self,
        s1_channels: int = S1_CHANNELS,
        s2_channels: int = S2_CHANNELS,
        widths: tuple[int, ...] = WIDTHS,
        dropout: float = 0.2,
    ):
        super().__init__()
        self.enc_sar = Encoder(s1_channels, widths)
        self.enc_opt = Encoder(s2_channels, widths)
        self.fusions = nn.ModuleList(GatedFusion(w) for w in widths)
        self.decoder = Decoder(widths, dropout)

    def fused_features(self, s1: torch.Tensor, s2: torch.Tensor) -> tuple[list[torch.Tensor], torch.Tensor]:
        """Per-scale fused features and the finest-scale effective SAR gate."""
        v_sar, v_opt = s1[:, -1:], s2[:, -1:]
        f_sar, f_opt = self.enc_sar(s1), self.enc_opt(s2)
        fused, gate0 = [], None
        for i, (fs, fo, fusion) in enumerate(zip(f_sar, f_opt, self.fusions, strict=True)):
            k = 2**i
            vs = F.avg_pool2d(v_sar, k) if k > 1 else v_sar
            vo = F.avg_pool2d(v_opt, k) if k > 1 else v_opt
            vs, vo = vs[..., : fs.shape[-2], : fs.shape[-1]], vo[..., : fs.shape[-2], : fs.shape[-1]]
            f, g = fusion(fs, fo, vs, vo)
            fused.append(f)
            if i == 0:
                gate0 = g
        return fused, gate0  # type: ignore[return-value]

    def forward(
        self, s1: torch.Tensor, s2: torch.Tensor, return_gate: bool = False
    ) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
        fused, gate0 = self.fused_features(s1, s2)
        logits = self.decoder(fused)
        if return_gate:
            return logits, gate0
        return logits


MODEL_VARIANTS = {
    "s1_unet": {"inputs": "s1", "description": "Sentinel-1 only U-Net (learned SAR baseline)"},
    "s2_unet": {"inputs": "s2", "description": "Sentinel-2 only U-Net (learned optical baseline)"},
    "early_fusion_unet": {"inputs": "s1+s2", "description": "Early-fusion U-Net (channel concatenation)"},
    "gated_fusion_unet": {"inputs": "s1|s2", "description": "Dual-branch gated-fusion U-Net (modality dropout 15 %)"},
    "gated_fusion_unet_v2": {"inputs": "s1|s2",
                             "description": "Dual-branch gated-fusion U-Net, strong modality dropout (30 % optical removal, clouds up to 100 %)"},
}


def is_gated(name: str) -> bool:
    return name.startswith("gated_fusion_unet")


def build_model(name: str, dropout: float = 0.2) -> nn.Module:
    if name == "s1_unet":
        return UNet(S1_CHANNELS, dropout=dropout)
    if name == "s2_unet":
        return UNet(S2_CHANNELS, dropout=dropout)
    if name == "early_fusion_unet":
        return UNet(S1_CHANNELS + S2_CHANNELS, dropout=dropout)
    if is_gated(name):
        return GatedFusionUNet(dropout=dropout)
    raise ValueError(f"unknown model variant {name!r}")


def forward_variant(
    model: nn.Module, name: str, s1: torch.Tensor, s2: torch.Tensor, return_gate: bool = False
) -> tuple[torch.Tensor, torch.Tensor | None]:
    """Uniform call signature over all variants -> (logits, gate or None)."""
    if name == "s1_unet":
        return model(s1), None
    if name == "s2_unet":
        return model(s2), None
    if name == "early_fusion_unet":
        return model(torch.cat([s1, s2], dim=1)), None
    if not is_gated(name):
        raise ValueError(f"unknown model variant {name!r}")
    if return_gate:
        logits, gate = model(s1, s2, return_gate=True)
        return logits, gate
    return model(s1, s2), None


def trunk_features(
    model: nn.Module, name: str, s1: torch.Tensor, s2: torch.Tensor
) -> tuple[torch.Tensor, torch.Tensor | None]:
    """Full-resolution decoder features (before dropout/head) and the SAR gate if any.

    Used for cheap Monte-Carlo dropout: the trunk runs once, only dropout + head are resampled.
    """
    if is_gated(name):
        fused, gate = model.fused_features(s1, s2)
        return model.decoder.trunk(fused), gate
    if name == "early_fusion_unet":
        return model.decoder.trunk(model.encoder(torch.cat([s1, s2], dim=1))), None
    if name == "s1_unet":
        return model.decoder.trunk(model.encoder(s1)), None
    return model.decoder.trunk(model.encoder(s2)), None


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)
