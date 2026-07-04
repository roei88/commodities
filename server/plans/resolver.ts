import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import Ajv from "ajv";
import type { PlanAsset, CommodityMeta } from "../../shared/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLANS_DIR = join(__dirname, "..", "..", "plans");

const ajv = new Ajv({ allErrors: true, strict: false });
const schema = JSON.parse(readFileSync(join(PLANS_DIR, "plan.schema.json"), "utf8"));
const validate = ajv.compile(schema);

export interface RegistryEntry extends CommodityMeta {}

let registryCache: RegistryEntry[] | null = null;

export function loadRegistry(): RegistryEntry[] {
  if (registryCache) return registryCache;
  const raw = JSON.parse(readFileSync(join(PLANS_DIR, "registry.json"), "utf8"));
  registryCache = raw.commodities as RegistryEntry[];
  return registryCache;
}

export function getCommodity(id: string): RegistryEntry | undefined {
  return loadRegistry().find((c) => c.id === id);
}

// Load a single raw plan file by id from any of the plan folders.
function loadRawPlan(id: string): any | undefined {
  const candidates = [
    join(PLANS_DIR, `${id}.json`),
    join(PLANS_DIR, "classes", `${id}.json`),
    join(PLANS_DIR, "assets", `${id}.json`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  return undefined;
}

// Deep-merge: objects merge key-by-key (last wins), arrays and scalars replace.
function deepMerge(base: any, over: any): any {
  if (over === undefined) return base;
  if (Array.isArray(over) || typeof over !== "object" || over === null) return over;
  const out: any = { ...(base ?? {}) };
  for (const k of Object.keys(over)) {
    const bv = base ? base[k] : undefined;
    const ov = over[k];
    if (ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      out[k] = deepMerge(bv, ov);
    } else {
      out[k] = ov;
    }
  }
  return out;
}

// Resolve a plan by walking its `extends` chain up to `universal`, merging base -> over.
function resolveChain(id: string, seen = new Set<string>()): any {
  if (seen.has(id)) throw new Error(`Plan extends cycle at "${id}"`);
  seen.add(id);
  const raw = loadRawPlan(id);
  if (!raw) throw new Error(`Plan asset not found: "${id}"`);
  if (raw.extends) {
    const parent = resolveChain(raw.extends, seen);
    return deepMerge(parent, raw);
  }
  return raw;
}

export interface ResolvedPlan {
  plan: PlanAsset;
  resolution: string; // "dedicated:gold" | "class:energy" | "universal"
  planHash: string;
}

// Pick the most-specific plan for a commodity: dedicated asset > class > universal.
export function resolvePlanFor(commodity: CommodityMeta): ResolvedPlan {
  let startId: string;
  let resolution: string;
  if (existsSync(join(PLANS_DIR, "assets", `${commodity.id}.json`))) {
    startId = commodity.id;
    resolution = `dedicated:${commodity.id}`;
  } else if (existsSync(join(PLANS_DIR, "classes", `${commodity.class}.json`))) {
    startId = commodity.class;
    resolution = `class:${commodity.class}`;
  } else {
    startId = "universal";
    resolution = "universal";
  }

  const merged = resolveChain(startId);

  // Fill dataInputs.primarySymbol / cotContractCode from the registry if the plan omits them.
  merged.dataInputs = merged.dataInputs ?? {};
  if (!merged.dataInputs.primarySymbol) merged.dataInputs.primarySymbol = commodity.symbol;
  if (!merged.dataInputs.cotContractCode && commodity.cotContractCode)
    merged.dataInputs.cotContractCode = commodity.cotContractCode;
  if (!merged.dataInputs.fallbackSymbols) {
    merged.dataInputs.fallbackSymbols = [commodity.stooq, commodity.twelvedata].filter(Boolean) as string[];
  }

  if (!validate(merged)) {
    const msg = (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ");
    throw new Error(`Resolved plan for "${commodity.id}" failed schema validation: ${msg}`);
  }

  const planHash = createHash("sha256").update(JSON.stringify(merged)).digest("hex").slice(0, 12);
  return { plan: merged as PlanAsset, resolution, planHash };
}

// List all user-addable dedicated plan asset ids (for the "add plan" UI / listing).
export function listDedicatedPlans(): string[] {
  const dir = join(PLANS_DIR, "assets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

// Validate a raw plan object (used by the "add plan" endpoint before saving).
export function validateRawPlan(obj: any): { ok: boolean; errors?: string[] } {
  if (!validate(obj)) {
    return { ok: false, errors: (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) };
  }
  return { ok: true };
}
