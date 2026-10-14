export function combinationsOfFive<T>(items: readonly T[]): T[][] {
  const combinations: T[][] = [];

  for (let first = 0; first < items.length - 4; first += 1) {
    for (let second = first + 1; second < items.length - 3; second += 1) {
      for (let third = second + 1; third < items.length - 2; third += 1) {
        for (let fourth = third + 1; fourth < items.length - 1; fourth += 1) {
          for (let fifth = fourth + 1; fifth < items.length; fifth += 1) {
            const combination = [
              items[first],
              items[second],
              items[third],
              items[fourth],
              items[fifth],
            ];

            if (combination.every((item) => item !== undefined)) {
              combinations.push(combination as T[]);
            }
          }
        }
      }
    }
  }

  return combinations;
}
