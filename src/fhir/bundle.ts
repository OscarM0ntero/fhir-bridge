import { randomUUID } from 'node:crypto';

import type { Bundle, BundleEntry, FhirResource } from 'fhir/r4.js';

import { IDENTIFIER_SYSTEMS } from './identifiers.js';
import { mapCondition, mapObservation, mapPatient, type MappingContext } from './mapper.js';
import type { MappingWarning, PatientGroup } from './patient-groups.js';

/** Where an entry came from, so a complaint about it can name a CSV row. */
export interface EntrySource {
  readonly resourceType: 'Patient' | 'Condition' | 'Observation';
  /** The rows behind the entry. A Patient is built from all of the patient's rows. */
  readonly sourceRows: readonly number[];
  readonly recordId: string | undefined;
}

export interface PatientTransaction {
  readonly mrn: string;
  readonly bundle: Bundle;
  /** sources[i] describes bundle.entry[i]. */
  readonly sources: readonly EntrySource[];
  readonly warnings: readonly MappingWarning[];
}

export interface TransactionOptions {
  readonly timezoneOffset: string;
  /** Injected by tests so that a bundle is predictable. */
  readonly newId?: () => string;
}

/**
 * Puts everything one patient contributes into a single transaction bundle.
 *
 * The resources refer to each other by the temporary urn:uuid of their entry,
 * which the server swaps for the real ids when it commits the transaction. That
 * is what lets the whole set be validated before anything is stored, and what
 * keeps a patient from being left half uploaded when one of its rows is wrong.
 *
 * Every entry is a conditional update keyed on the identifier the legacy system
 * provides, so running the pipeline twice updates rather than duplicates.
 */
export function buildPatientTransaction(group: PatientGroup, options: TransactionOptions): PatientTransaction {
  const newId = options.newId ?? randomUUID;
  const patientUrl = `urn:uuid:${newId()}`;
  const context: MappingContext = {
    patientReference: patientUrl,
    timezoneOffset: options.timezoneOffset,
  };

  const entries: BundleEntry[] = [
    entry(patientUrl, mapPatient(group), conditionalUrl('Patient', IDENTIFIER_SYSTEMS.medicalRecordNumber, group.mrn)),
  ];
  const sources: EntrySource[] = [
    {
      resourceType: 'Patient',
      sourceRows: group.records.map((record) => record.sourceRow),
      recordId: undefined,
    },
  ];
  const warnings: MappingWarning[] = [];

  for (const record of group.records) {
    const condition = mapCondition(record, context);
    warnings.push(...condition.warnings);
    entries.push(
      entry(
        `urn:uuid:${newId()}`,
        condition.resource,
        conditionalUrl('Condition', IDENTIFIER_SYSTEMS.record, record.recordId),
      ),
    );
    sources.push({ resourceType: 'Condition', sourceRows: [record.sourceRow], recordId: record.recordId });

    const observation = mapObservation(record, context);
    if (observation !== undefined) {
      warnings.push(...observation.warnings);
      entries.push(
        entry(
          `urn:uuid:${newId()}`,
          observation.resource,
          conditionalUrl('Observation', IDENTIFIER_SYSTEMS.labResult, record.recordId),
        ),
      );
      sources.push({ resourceType: 'Observation', sourceRows: [record.sourceRow], recordId: record.recordId });
    }
  }

  return {
    mrn: group.mrn,
    bundle: { resourceType: 'Bundle', type: 'transaction', entry: entries },
    sources,
    warnings,
  };
}

/**
 * The search that decides whether the entry creates or updates. The value is
 * percent encoded because a raw comma or ampersand in it would otherwise be
 * read as search syntax rather than as part of the identifier.
 */
export function conditionalUrl(resourceType: string, system: string, value: string): string {
  return `${resourceType}?identifier=${encodeURIComponent(system)}|${encodeURIComponent(value)}`;
}

function entry(fullUrl: string, resource: FhirResource, url: string): BundleEntry {
  return { fullUrl, resource, request: { method: 'PUT', url } };
}
