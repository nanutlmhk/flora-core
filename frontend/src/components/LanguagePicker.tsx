import { useLanguage } from "../context/LanguageContext";
import ClinicalReferenceTooltip from "./common/ClinicalReferenceTooltip";

export default function LanguagePicker({ loginScreen = false, compact = false }: { loginScreen?: boolean; compact?: boolean }) {
  const { language, languages, setLanguage, t } = useLanguage();
  if (languages.length === 2) {
    const target = languages.find(option => option.code !== language) || languages[0];
    const targetLabel = target.code === "en" ? "EN" : target.nameNative;
    return <ClinicalReferenceTooltip text={`${t("language.switchTo")} ${target.nameNative}`} compact>
      <button
        type="button"
        onClick={() => setLanguage(target.code, loginScreen)}
        aria-label={`${t("language.switchTo")} ${target.nameNative}`}
        className={`inline-flex items-center justify-center rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] font-bold text-[var(--app-text)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] ${compact ? "h-8 min-w-[42px] px-[8px] text-[11px]" : "h-[40px] min-w-[54px] px-[11px] text-[12px]"}`}
      >
        {targetLabel}
      </button>
    </ClinicalReferenceTooltip>;
  }
  return (
    <label className={`relative inline-flex items-center rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] text-[12px] font-bold text-[var(--app-text)] focus-within:border-[var(--app-accent)] ${compact ? "h-8 px-[7px]" : "h-[40px] px-[10px]"}`}>
      <span aria-hidden="true" className={`${compact ? "mr-[4px] text-[12px]" : "mr-[6px] text-[14px]"}`}>文</span>
      <span className="sr-only">{t("language.choose")}</span>
      <select
        value={language}
        onChange={event => setLanguage(event.target.value, loginScreen)}
        aria-label={t("language.choose")}
        className="cursor-pointer appearance-none bg-transparent pr-[16px] text-[12px] font-bold text-[var(--app-text)] outline-none"
      >
        {languages.map(option => (
          <option key={option.code} value={option.code} className="bg-[var(--app-panel-bg)] text-[var(--app-text)]">
            {option.code.toUpperCase()}{compact ? "" : ` · ${option.nameNative}`}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-[8px]">⌄</span>
    </label>
  );
}
