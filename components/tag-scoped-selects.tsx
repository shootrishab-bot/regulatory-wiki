"use client";

import * as React from "react";
import { MultiSelect, type MultiOption } from "@/components/multi-select";
import type { RegulatorTagOptions } from "@/lib/queries";

/**
 * Domain / Regulator / Subject / Instrument Type, wherever documents are
 * filtered.
 *
 * These four belong together because each one narrows the next:
 *
 *   domain    -> the regulator list shows only that sector's regulators
 *   regulator -> the subject and instrument lists show only its vocabulary
 *
 * Subject and Instrument Type are per-regulator vocabularies that are not
 * comparable across regulators -- MTCTE's "Exemptions" and MIB's "Advisory"
 * are not two values of one list. With several regulators picked, their tags
 * are shown under a heading each rather than merged, so the boundary stays
 * visible in the one place a combined list could otherwise mislead.
 *
 * Why this is a client component. The filter bars are plain GET forms, which
 * is deliberate: no JavaScript needed to submit, shareable URLs, correct
 * back button. But it meant the scoped dropdowns only learned about a
 * regulator AFTER the form was submitted and the server re-rendered. Picking
 * "MERC" left Subject greyed out saying "Pick a regulator first" -- telling
 * you to do the thing you had just done. Reported from real use, 2026-09-17.
 * Every regulator's tags are now handed over up front and the narrowing
 * happens locally, the moment a selection changes.
 *
 * Selections that can no longer apply are dropped rather than left to filter
 * to zero rows and look like a bug: narrowing the domains drops regulators
 * outside them, and changing the regulators drops their tags.
 */
export function TagScopedSelects({
  domains,
  tagsByRegulator,
  current,
  fieldClassName,
  labelClassName,
  idPrefix = "filter",
}: {
  /** Every domain, each with the regulators inside it. */
  domains: { id: string; name: string; regulators: { code: string; name: string }[] }[];
  tagsByRegulator: Record<string, RegulatorTagOptions>;
  current: {
    domain?: string | string[];
    regulator?: string | string[];
    subject?: string | string[];
    instrument?: string | string[];
  };
  fieldClassName: string;
  labelClassName: string;
  idPrefix?: string;
}) {
  const asList = (v: string | string[] | undefined) =>
    v === undefined ? [] : Array.isArray(v) ? v.filter(Boolean) : [v];

  const [domainIds, setDomainIds] = React.useState<string[]>(() => asList(current.domain));
  const [regulators, setRegulators] = React.useState<string[]>(() => asList(current.regulator));
  const [subjects, setSubjects] = React.useState<string[]>(() => asList(current.subject));
  const [instruments, setInstruments] = React.useState<string[]>(() =>
    asList(current.instrument)
  );

  // With no domain chosen the regulator list is everything; with one or more
  // chosen it is only theirs, which is the whole point of picking a domain
  // first.
  const regulatorsInScope = React.useMemo(() => {
    const inScope =
      domainIds.length === 0
        ? domains.flatMap((d) => d.regulators)
        : domains.filter((d) => domainIds.includes(d.id)).flatMap((d) => d.regulators);
    return inScope.slice().sort((a, b) => a.code.localeCompare(b.code));
  }, [domains, domainIds]);

  const tagOptions = React.useMemo(() => {
    const showGroups = regulators.length > 1;
    const subjectOpts: MultiOption[] = [];
    const instrumentOpts: MultiOption[] = [];
    for (const code of regulators) {
      const tags = tagsByRegulator[code];
      if (!tags) continue;
      for (const t of tags.subjects) {
        subjectOpts.push({ value: t.id, label: t.name, group: showGroups ? code : undefined });
      }
      for (const t of tags.instrumentTypes) {
        instrumentOpts.push({ value: t.id, label: t.name, group: showGroups ? code : undefined });
      }
    }
    return { subjectOpts, instrumentOpts };
  }, [regulators, tagsByRegulator]);

  function onDomainsChange(next: string[]) {
    setDomainIds(next);
    const allowed = new Set(
      (next.length === 0
        ? domains.flatMap((d) => d.regulators)
        : domains.filter((d) => next.includes(d.id)).flatMap((d) => d.regulators)
      ).map((r) => r.code)
    );
    const keptRegulators = regulators.filter((c) => allowed.has(c));
    if (keptRegulators.length !== regulators.length) {
      setRegulators(keptRegulators);
      pruneTags(keptRegulators);
    }
  }

  function onRegulatorsChange(next: string[]) {
    setRegulators(next);
    pruneTags(next);
  }

  /** Drop any tag whose regulator is no longer selected. */
  function pruneTags(codes: string[]) {
    const validSubjects = new Set(
      codes.flatMap((c) => (tagsByRegulator[c]?.subjects ?? []).map((t) => t.id))
    );
    const validInstruments = new Set(
      codes.flatMap((c) => (tagsByRegulator[c]?.instrumentTypes ?? []).map((t) => t.id))
    );
    setSubjects((prev) => prev.filter((id) => validSubjects.has(id)));
    setInstruments((prev) => prev.filter((id) => validInstruments.has(id)));
  }

  const scoped = regulators.length > 0;

  return (
    <>
      <div className="flex-[2_1_170px]">
        <label htmlFor={`${idPrefix}-domain`} className={labelClassName}>
          Domain
        </label>
        <MultiSelect
          id={`${idPrefix}-domain`}
          name="domain"
          options={domains.map((d) => ({ value: d.id, label: d.name }))}
          values={domainIds}
          onChange={onDomainsChange}
          placeholder="All domains"
          fieldClassName={fieldClassName}
        />
      </div>

      <div className="flex-1 basis-[160px]">
        <label htmlFor={`${idPrefix}-regulator`} className={labelClassName}>
          Regulator
        </label>
        <MultiSelect
          id={`${idPrefix}-regulator`}
          name="regulator"
          options={regulatorsInScope.map((r) => ({ value: r.code, label: r.code }))}
          values={regulators}
          onChange={onRegulatorsChange}
          placeholder={
            domainIds.length === 0
              ? "All regulators"
              : `All in ${domainIds.length === 1 ? "domain" : "domains"}`
          }
          fieldClassName={fieldClassName}
        />
      </div>

      <div className="flex-[2_1_180px]">
        <label htmlFor={`${idPrefix}-subject`} className={labelClassName}>
          Subject
        </label>
        <MultiSelect
          id={`${idPrefix}-subject`}
          name="subject"
          options={tagOptions.subjectOpts}
          values={subjects}
          onChange={setSubjects}
          placeholder="All subjects"
          disabled={!scoped}
          disabledLabel="Pick a regulator first"
          fieldClassName={fieldClassName}
        />
      </div>

      <div className="flex-[2_1_180px]">
        <label htmlFor={`${idPrefix}-instrument`} className={labelClassName}>
          Instrument type
        </label>
        <MultiSelect
          id={`${idPrefix}-instrument`}
          name="instrument"
          options={tagOptions.instrumentOpts}
          values={instruments}
          onChange={setInstruments}
          placeholder="All instrument types"
          disabled={!scoped}
          disabledLabel="Pick a regulator first"
          fieldClassName={fieldClassName}
        />
      </div>
    </>
  );
}
