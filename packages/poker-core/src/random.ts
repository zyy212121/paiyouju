export interface RandomIntSource {
  /** Returns a uniformly distributed integer in [0, exclusiveMax). */
  nextInt(exclusiveMax: number): number;
}
