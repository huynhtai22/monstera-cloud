/**
 * TEST-ONLY SIMULATION ADAPTER
 *
 * DO NOT IMPORT THIS FILE IN PRODUCTION ROUTES OR RUNTIME CODE.
 * This module is strictly restricted to testing environments and unit test suites.
 */

import {
  type CertificationEvidencePack,
  type CertificationHarnessInput,
  type CertificationLevel,
  type ProviderAccessFacts,
} from "./types";
import { CertificationHarness } from "./harness";

export interface TestSimulationOptions {
  simulatedConnection?: boolean;
  simulatedWarehouseRows?: number;
  simulatedWarehouseTotals?: {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
    accountTimezone?: string;
    currency?: string;
  };
  simulatedDestinationReceiptId?: string;
  simulatedRecoveryPassed?: boolean;
  unjustifiedSandboxExemption?: boolean;
  unjustifiedGateExemption?: CertificationLevel;
  simulatedProviderAccessFacts?: ProviderAccessFacts;
  simulatePersistedLiveState?: boolean;
}

export interface TestSimulatedHarnessInput extends CertificationHarnessInput {
  simulation?: TestSimulationOptions;
}

export class TestCertificationHarness extends CertificationHarness {
  /**
   * Test-only execution path allowing unit tests to verify gate mechanics and calculations.
   *
   * STRICT SECURITY INVARIANT:
   * Any synthetic_fixture MUST ALWAYS produce certificationEligible: false and pilotEligible: false.
   * Synthetic evidence must NEVER advance through live gates or produce PILOT_CERTIFIED,
   * even with matching simulated metrics.
   */
  public async executeTestSimulation(
    input: TestSimulatedHarnessInput
  ): Promise<{
    evidencePack: CertificationEvidencePack;
    markdownReport: string;
    evidenceJsonPath: string;
    evidenceMdPath: string;
  }> {
    return this.executeInternal(input, input.simulation);
  }
}
