// src/lib/report.js
// Generates a structured downloadable validation report from a validation run result
export function buildValidationReport({ validationRun, manifest = null }) {
  const result = typeof validationRun.result_json === "string"
    ? JSON.parse(validationRun.result_json)
    : validationRun.result_json;

  return {
    report_id: `vrpt_${validationRun.id}`,
    generated_at: new Date().toISOString(),
    registry_version: "0.3.0",
    validation_id: validationRun.id,
    airpp_version: result.airpp_version || "0.2.0",
    summary: {
      ok: result.ok,
      claimed_conformance_level: result.claimed_conformance_level,
      validated_conformance_level: result.validated_conformance_level,
      error_count: (result.errors || []).length,
      warning_count: (result.warnings || []).length,
    },
    checks: result.checks || {},
    errors: result.errors || [],
    warnings: result.warnings || [],
    computed: result.computed || {},
    manifest_metadata: manifest ? {
      manifest_id: manifest.manifest_id,
      report_title: manifest.report?.title,
      report_output_type: manifest.report?.output_type,
      manifest_hash: manifest.integrity?.manifest_hash?.value,
    } : null,
    notes: [
      "This report reflects the result of AIRPP v0.2.0 conformance validation.",
      "Validation checks schema structure, accountable actor presence, required fields, and internal reference integrity.",
      "A passing result does not constitute professional certification.",
    ],
  };
}
