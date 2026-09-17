import type { ReactNode } from "react";
import ClinicalReferenceTooltip from "../common/ClinicalReferenceTooltip";

type HeaderCardProps = {
  group: string;
  count?: number;
  icon?: string;
  main: ReactNode;
  sub1?: ReactNode;
  sub2?: ReactNode;
  tooltip?: string;
  onClick?: () => void;
  ariaLabel?: string;
  tone?: "default" | "alert";
  emphasis?: boolean;
};

function CardContent({ group, count, icon, main, sub1, sub2 }: Omit<HeaderCardProps, "onClick" | "ariaLabel" | "tone" | "tooltip">) {
  return (
    <>
      <span className="case-header-card__group">{icon ? <img src={icon} alt="" aria-hidden="true" className="case-header-card__icon" /> : null}<span>{group}</span>{count && count > 0 ? <span className="case-header-card__count" aria-label={`${count} records`}>{count}</span> : null}</span>
      <strong className="case-header-card__main">{main}</strong>
      {sub1 ? <span className="case-header-card__sub">{sub1}</span> : null}
      {sub2 ? <span className="case-header-card__sub">{sub2}</span> : null}
    </>
  );
}

export default function HeaderCard({
  group,
  count,
  icon,
  main,
  sub1,
  sub2,
  tooltip,
  onClick,
  ariaLabel,
  tone = "default",
  emphasis = false,
}: HeaderCardProps) {
  const className = `case-header-card${tone === "alert" ? " case-header-card--alert" : ""}${onClick ? " case-header-card--interactive" : ""}${emphasis ? " case-header-card--emphasis" : ""}`;
  const card = onClick ? (
      <button type="button" className={className} onClick={onClick} aria-label={ariaLabel || group}>
        <CardContent group={group} count={count} icon={icon} main={main} sub1={sub1} sub2={sub2} />
      </button>
  ) : (
    <section className={className} aria-label={ariaLabel || group}>
      <CardContent group={group} count={count} icon={icon} main={main} sub1={sub1} sub2={sub2} />
    </section>
  );
  return tooltip ? (
    <ClinicalReferenceTooltip text={tooltip} className="h-full w-full">
      {card}
    </ClinicalReferenceTooltip>
  ) : card;
}
