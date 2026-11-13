import { ChevronRight } from "lucide-react";
import credits from "@/data/explainer-images.json";
import { fmtDate } from "@/lib/format";

type Entry = { analysis?: string; before_date?: string; after_date?: string; credit: string };
const C = (credits as Record<string, Entry>)["explain-sindh-2022"];

/**
 * Four real panels from one completed analysis (Sindh floods, Pakistan, 2022), produced by
 * backend/scripts/make_explainer_images.py. Shows the whole method without a paragraph of text.
 */
export function ExplainerStrip({ headingLevel = 3 }: { headingLevel?: 3 | 4 }) {
  const H = headingLevel === 3 ? "h3" : "h4";
  const steps = [
    { img: "before", title: "1. Before", text: "An optical satellite image (Sentinel-2) of the place before the floods.", meta: C?.before_date ? fmtDate(C.before_date) : "" },
    { img: "after", title: "2. After", text: "An image of the same place taken after the floods began.", meta: C?.after_date ? fmtDate(C.after_date) : "" },
    { img: "change", title: "3. What changed", text: "AegisEO compares the images and marks what changed: here, new flood water in blue.", meta: "Found by AegisEO" },
    { img: "priorities", title: "4. Where to look first", text: "The area is divided into 1 km squares, each with a priority. Orange (High) and red (Critical) squares should be checked first.", meta: "Ranked by AegisEO" },
  ];
  return (
    <figure style={{ margin: 0 }}>
      <div className="steps-visual">
        {steps.map((s, i) => (
          <div className="sv-item rise" style={{ animationDelay: `${0.08 * i}s` }} key={s.img}>
            <div className="sv-img">
              <img src={`/images/explain-sindh-2022-${s.img}.jpg`} alt={`${s.title.slice(3)}: ${s.text}`} loading="lazy" width={720} height={803} />
              <span className="sv-num" aria-hidden>{i + 1}</span>
            </div>
            {i < steps.length - 1 && <span className="sv-arrow" aria-hidden><ChevronRight size={16} /></span>}
            <H style={{ marginTop: 14 }}>{s.title.slice(3)}</H>
            <p>{s.text}</p>
            {s.meta && <div className="sv-meta">{s.meta}</div>}
          </div>
        ))}
      </div>
      <figcaption className="caption muted" style={{ marginTop: 16 }}>
        A real example: Dadu district, Sindh, Pakistan, during the 2022 monsoon floods. {C?.credit ?? "Contains modified Copernicus Sentinel data 2022"}.
      </figcaption>
    </figure>
  );
}
