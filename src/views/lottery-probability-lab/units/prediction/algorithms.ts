import type {
  AlgorithmId,
  AuditPair,
  AuditReport,
  BallFrequency,
  CoverageProofStep,
  DrawRecord,
  LotteryCombination,
  PrizeCoverageGroup,
  PrizeCoverageTicket,
} from "../../types";
import { LOTTERY_CONSTANTS } from "../../types";

interface RandomSource {
  next: () => number;
}

interface AlgorithmEvidenceProfile {
  redWeights: number[];
  blueWeights: number[];
  description: string;
}

export interface EnsembleWeights {
  bayesianStatic: number;
  timeDecay: number;
}

export function generateCombinations(
  algorithmId: AlgorithmId,
  draws: readonly DrawRecord[],
  seed: number,
  options: { ensembleWeights?: EnsembleWeights; target?: number } = {},
): LotteryCombination[] {
  const random = createRandom(seed);
  const target = options.target ?? 3;

  switch (algorithmId) {
    case "bayesian-static":
      return uniqueCombinations(
        () => createWeightedCombination(staticWeights(draws), random),
        random,
        target,
      );
    case "time-decay":
      return uniqueCombinations(
        () => createWeightedCombination(timeDecayWeights(draws), random),
        random,
        target,
      );
    case "pair-dependence":
      return generatePairDependentCombinations(draws, random, target);
    case "coverage-optimizer":
      return generateCoverageCombinations(draws, random, target);
    case "scored-ensemble":
      return generateEnsembleCombinations(
        draws,
        random,
        options.ensembleWeights ?? equalEnsembleWeights(),
        target,
      );
    case "uniform-baseline":
    default:
      return uniqueCombinations(
        () => createUniformCombination(random),
        random,
        target,
      );
  }
}

export function generatePrizeCoverageGroups(
  algorithmId: AlgorithmId,
  draws: readonly DrawRecord[],
  seed: number,
  ensembleWeights: EnsembleWeights = equalEnsembleWeights(),
): PrizeCoverageGroup[] {
  const anchors = generateCombinations(algorithmId, draws, seed, {
    ensembleWeights,
    target: 5,
  });
  const profile = createEvidenceProfile(algorithmId, draws, ensembleWeights);
  const used = new Set<string>();
  const groups: PrizeCoverageGroup[] = [];

  anchors.forEach((anchor, index) => {
    const groupIndex = index + 1;
    const firstPrizeAnchor: PrizeCoverageTicket = {
      ...cloneCombination(anchor),
      groupIndex,
      role: "first-anchor",
    };
    used.add(combinationKey(firstPrizeAnchor));

    const {
      ticket: secondPrizeBlueCover,
      blueRank,
      blueWeight,
    } = createBlueCover(firstPrizeAnchor, profile, used, groupIndex);
    used.add(combinationKey(secondPrizeBlueCover));

    const {
      ticket: thirdPrizeRedCover,
      removedRed,
      replacementRed,
      replacementRank,
      replacementWeight,
    } = createRedCover(firstPrizeAnchor, profile, used, groupIndex);
    used.add(combinationKey(thirdPrizeRedCover));

    const proofSteps: CoverageProofStep[] = [
      {
        label: "算法锚点",
        value:
          anchor.score === null
            ? "均匀抽样"
            : `组合分 ${anchor.score.toFixed(3)}`,
        detail: profile.description,
      },
      {
        label: "一等奖锚点票",
        value: `${formatNumbers(firstPrizeAnchor.redNumbers)} + ${formatNumber(firstPrizeAnchor.blueNumber)}`,
        detail: "6 红 + 主蓝，是本大组的条件锚点。",
      },
      {
        label: "二等奖蓝球覆盖",
        value: `${formatNumbers(secondPrizeBlueCover.redNumbers)} + ${formatNumber(secondPrizeBlueCover.blueNumber)}`,
        detail: `与锚点保留 6 红；备用蓝球排名第 ${blueRank}，当前权重 ${blueWeight.toFixed(3)}。`,
      },
      {
        label: "三等奖红球覆盖",
        value: `${formatNumbers(thirdPrizeRedCover.redNumbers)} + ${formatNumber(thirdPrizeRedCover.blueNumber)}`,
        detail: `保留锚点 5 红和主蓝；红球 ${formatNumber(removedRed)} 替换为 ${formatNumber(replacementRed)}，候补红球排名第 ${replacementRank}，权重 ${replacementWeight.toFixed(3)}。`,
      },
    ];

    groups.push({
      groupIndex,
      firstPrizeAnchor,
      secondPrizeBlueCover,
      thirdPrizeRedCover,
      proofSteps,
    });
  });

  return groups;
}

export function equalEnsembleWeights(): EnsembleWeights {
  return { bayesianStatic: 0.5, timeDecay: 0.5 };
}

export function createAuditReport(draws: readonly DrawRecord[]): AuditReport {
  const redFrequencies = countFrequencies(
    draws,
    LOTTERY_CONSTANTS.redMaximum,
    (draw) => draw.redNumbers,
  );
  const blueFrequencies = countFrequencies(
    draws,
    LOTTERY_CONSTANTS.blueMaximum,
    (draw) => [draw.blueNumber],
  );
  const expectedRed =
    (draws.length * LOTTERY_CONSTANTS.redCount) / LOTTERY_CONSTANTS.redMaximum;
  const expectedBlue = draws.length / LOTTERY_CONSTANTS.blueMaximum;
  const recentWindowSize = Math.min(draws.length, 30);
  const recentDraws = draws.slice(-recentWindowSize);
  const recentRed = countFrequencies(
    recentDraws,
    LOTTERY_CONSTANTS.redMaximum,
    (draw) => draw.redNumbers,
  );
  const redChiSquare = chiSquare(redFrequencies, expectedRed);
  const blueChiSquare = chiSquare(blueFrequencies, expectedBlue);
  const leaders = [...recentRed]
    .sort(
      (left, right) => right.count - left.count || left.number - right.number,
    )
    .slice(0, 6);

  return {
    generatedAt: new Date().toISOString(),
    totalDraws: draws.length,
    redChiSquare,
    blueChiSquare,
    recentWindowSize,
    recentRedLeaders: leaders,
    frequentPairs: calculateFrequentPairs(draws),
    metrics: [
      {
        label: "红球频率离散度",
        value: redChiSquare.toFixed(2),
        description: `以每号理论期望 ${expectedRed.toFixed(2)} 次计算的描述性 χ² 值。`,
      },
      {
        label: "蓝球频率离散度",
        value: blueChiSquare.toFixed(2),
        description: `以每号理论期望 ${expectedBlue.toFixed(2)} 次计算的描述性 χ² 值。`,
      },
      {
        label: "近期窗口",
        value: `${recentWindowSize} 期`,
        description: "仅用于观察近期分布，不能推出下一期必出号码。",
      },
      {
        label: "红球对理论期望",
        value: `${((draws.length * 5) / 176).toFixed(2)} 次`,
        description: "任意指定红球对在公平抽取下的共同出现期望。",
      },
    ],
    conclusion:
      "审计仅描述历史分布和偏离程度；它不能证明开奖可预测。请将任何研究模型与均匀基准的时间顺序回测比较。",
  };
}

function createBlueCover(
  anchor: PrizeCoverageTicket,
  profile: AlgorithmEvidenceProfile,
  used: ReadonlySet<string>,
  groupIndex: number,
): { ticket: PrizeCoverageTicket; blueRank: number; blueWeight: number } {
  const candidates = rankNumbers(profile.blueWeights);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.number === anchor.blueNumber) continue;
    const ticket: PrizeCoverageTicket = {
      redNumbers: [...anchor.redNumbers],
      blueNumber: candidate.number,
      score: anchor.score,
      groupIndex,
      role: "second-blue-cover",
    };
    if (!used.has(combinationKey(ticket)))
      return { ticket, blueRank: index + 1, blueWeight: candidate.weight };
  }
  throw new Error("无法为奖级覆盖选择备用蓝球。");
}

function createRedCover(
  anchor: PrizeCoverageTicket,
  profile: AlgorithmEvidenceProfile,
  used: ReadonlySet<string>,
  groupIndex: number,
): {
  ticket: PrizeCoverageTicket;
  removedRed: number;
  replacementRed: number;
  replacementRank: number;
  replacementWeight: number;
} {
  const removalOrder = [...anchor.redNumbers].sort(
    (left, right) =>
      profile.redWeights[left - 1] - profile.redWeights[right - 1] ||
      right - left,
  );
  const replacementCandidates = rankNumbers(profile.redWeights);

  for (const removedRed of removalOrder) {
    const retained = anchor.redNumbers.filter(
      (number) => number !== removedRed,
    );
    for (let index = 0; index < replacementCandidates.length; index += 1) {
      const candidate = replacementCandidates[index];
      if (anchor.redNumbers.includes(candidate.number)) continue;
      const ticket: PrizeCoverageTicket = {
        redNumbers: [...retained, candidate.number].sort(
          (left, right) => left - right,
        ),
        blueNumber: anchor.blueNumber,
        score: anchor.score,
        groupIndex,
        role: "third-red-cover",
      };
      if (!used.has(combinationKey(ticket))) {
        return {
          ticket,
          removedRed,
          replacementRed: candidate.number,
          replacementRank: index + 1,
          replacementWeight: candidate.weight,
        };
      }
    }
  }
  throw new Error("无法为奖级覆盖选择替换红球。");
}

function createEvidenceProfile(
  algorithmId: AlgorithmId,
  draws: readonly DrawRecord[],
  ensembleWeights: EnsembleWeights,
): AlgorithmEvidenceProfile {
  if (algorithmId === "uniform-baseline") {
    return {
      redWeights: Array.from({ length: LOTTERY_CONSTANTS.redMaximum }, () => 1),
      blueWeights: Array.from(
        { length: LOTTERY_CONSTANTS.blueMaximum },
        () => 1,
      ),
      description:
        "均匀组合基准：所有号码的理论权重相同，候补顺序仅用于构造奖级覆盖票。",
    };
  }
  if (algorithmId === "time-decay") {
    const weights = timeDecayWeights(draws);
    return {
      redWeights: weights.red,
      blueWeights: weights.blue,
      description: "时间衰减权重：近期开奖记录的影响按指数衰减累计。",
    };
  }
  if (algorithmId === "scored-ensemble") {
    const staticProfile = staticWeights(draws);
    const timeProfile = timeDecayWeights(draws);
    return {
      redWeights: staticProfile.red.map(
        (weight, index) =>
          weight * ensembleWeights.bayesianStatic +
          timeProfile.red[index] * ensembleWeights.timeDecay,
      ),
      blueWeights: staticProfile.blue.map(
        (weight, index) =>
          weight * ensembleWeights.bayesianStatic +
          timeProfile.blue[index] * ensembleWeights.timeDecay,
      ),
      description: `评分集成：贝叶斯权重 ${ensembleWeights.bayesianStatic.toFixed(3)}，时间衰减权重 ${ensembleWeights.timeDecay.toFixed(3)}。`,
    };
  }
  const weights = staticWeights(draws);
  return {
    redWeights: weights.red,
    blueWeights: weights.blue,
    description:
      algorithmId === "pair-dependence"
        ? "组合依赖：锚点额外计入红球对共同出现的平滑分，覆盖候补使用收缩边际权重。"
        : algorithmId === "coverage-optimizer"
          ? "覆盖优化：锚点先按收缩权重形成候选池，再减少大组间红球重叠。"
          : "贝叶斯静态偏差：以公平基线为中心的收缩边际权重。",
  };
}

function rankNumbers(
  weights: readonly number[],
): { number: number; weight: number }[] {
  return weights
    .map((weight, index) => ({ number: index + 1, weight }))
    .sort(
      (left, right) => right.weight - left.weight || left.number - right.number,
    );
}

function uniqueCombinations(
  create: () => LotteryCombination,
  random: RandomSource,
  target = 3,
): LotteryCombination[] {
  const result: LotteryCombination[] = [];
  const keys = new Set<string>();
  let attempts = 0;
  while (result.length < target && attempts < 10_000) {
    attempts += 1;
    const combination = create();
    const key = combinationKey(combination);
    if (!keys.has(key)) {
      keys.add(key);
      result.push(combination);
    }
  }
  if (result.length < target)
    return uniqueCombinations(
      () => createUniformCombination(random),
      random,
      target,
    );
  return result;
}

function createUniformCombination(random: RandomSource): LotteryCombination {
  return {
    redNumbers: takeUniformNumbers(
      LOTTERY_CONSTANTS.redMaximum,
      LOTTERY_CONSTANTS.redCount,
      random,
    ),
    blueNumber: Math.floor(random.next() * LOTTERY_CONSTANTS.blueMaximum) + 1,
    score: null,
  };
}

function createWeightedCombination(
  weights: { red: number[]; blue: number[] },
  random: RandomSource,
): LotteryCombination {
  const redPool = Array.from(
    { length: LOTTERY_CONSTANTS.redMaximum },
    (_, index) => index + 1,
  );
  const redWeights = [...weights.red];
  const redNumbers: number[] = [];
  while (redNumbers.length < LOTTERY_CONSTANTS.redCount) {
    const index = pickWeightedIndex(redWeights, random);
    redNumbers.push(redPool[index]);
    redPool.splice(index, 1);
    redWeights.splice(index, 1);
  }
  const blueIndex = pickWeightedIndex(weights.blue, random);
  const score =
    redNumbers.reduce((total, number) => total + weights.red[number - 1], 0) +
    weights.blue[blueIndex];
  return {
    redNumbers: redNumbers.sort((left, right) => left - right),
    blueNumber: blueIndex + 1,
    score: Number(score.toFixed(3)),
  };
}

function generatePairDependentCombinations(
  draws: readonly DrawRecord[],
  random: RandomSource,
  target: number,
): LotteryCombination[] {
  const base = staticWeights(draws);
  const pairs = buildPairCounts(draws);
  const expectedPairCount = (draws.length * 5) / 176;
  const candidates = uniqueCombinations(
    () => createWeightedCombination(base, random),
    random,
    Math.max(220, target),
  );
  return candidates
    .map((candidate) => {
      const pairScore = allPairs(candidate.redNumbers).reduce(
        (total, [first, second]) =>
          total +
          Math.log(
            ((pairs.get(pairKey(first, second)) ?? 0) + 1) /
              (expectedPairCount + 1),
          ),
        0,
      );
      return {
        ...candidate,
        score: Number((candidate.score! + pairScore).toFixed(3)),
      };
    })
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, target);
}

function generateEnsembleCombinations(
  draws: readonly DrawRecord[],
  random: RandomSource,
  ensembleWeights: EnsembleWeights,
  target: number,
): LotteryCombination[] {
  const staticModel = staticWeights(draws);
  const timeModel = timeDecayWeights(draws);
  const blended = {
    red: staticModel.red.map(
      (weight, index) =>
        weight * ensembleWeights.bayesianStatic +
        timeModel.red[index] * ensembleWeights.timeDecay,
    ),
    blue: staticModel.blue.map(
      (weight, index) =>
        weight * ensembleWeights.bayesianStatic +
        timeModel.blue[index] * ensembleWeights.timeDecay,
    ),
  };
  return uniqueCombinations(
    () => createWeightedCombination(blended, random),
    random,
    target,
  );
}

function generateCoverageCombinations(
  draws: readonly DrawRecord[],
  random: RandomSource,
  target: number,
): LotteryCombination[] {
  const pool = uniqueCombinations(
    () => createWeightedCombination(staticWeights(draws), random),
    random,
    Math.max(160, target),
  ).sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  const selected: LotteryCombination[] = [];
  while (selected.length < target && pool.length) {
    const bestIndex = pool.reduce(
      (bestIndex, candidate, candidateIndex) =>
        coverageValue(candidate, selected) >
        coverageValue(pool[bestIndex], selected)
          ? candidateIndex
          : bestIndex,
      0,
    );
    selected.push(pool.splice(bestIndex, 1)[0]);
  }
  return selected.length === target
    ? selected
    : uniqueCombinations(
        () => createUniformCombination(random),
        random,
        target,
      );
}

function coverageValue(
  candidate: LotteryCombination,
  selected: readonly LotteryCombination[],
): number {
  const overlapPenalty = selected.reduce(
    (total, existing) =>
      total +
      candidate.redNumbers.filter((number) =>
        existing.redNumbers.includes(number),
      ).length *
        0.9 +
      (candidate.blueNumber === existing.blueNumber ? 0.35 : 0),
    0,
  );
  return (candidate.score ?? 0) - overlapPenalty;
}

function staticWeights(draws: readonly DrawRecord[]): {
  red: number[];
  blue: number[];
} {
  const redCounts = countFrequencies(
    draws,
    LOTTERY_CONSTANTS.redMaximum,
    (draw) => draw.redNumbers,
  );
  const blueCounts = countFrequencies(
    draws,
    LOTTERY_CONSTANTS.blueMaximum,
    (draw) => [draw.blueNumber],
  );
  const redBaseline = LOTTERY_CONSTANTS.redCount / LOTTERY_CONSTANTS.redMaximum;
  const blueBaseline = 1 / LOTTERY_CONSTANTS.blueMaximum;
  return {
    red: redCounts.map(
      ({ count }) => (count + 6) / (draws.length + 33) / redBaseline,
    ),
    blue: blueCounts.map(
      ({ count }) => (count + 1) / (draws.length + 16) / blueBaseline,
    ),
  };
}

function timeDecayWeights(draws: readonly DrawRecord[]): {
  red: number[];
  blue: number[];
} {
  const red = Array.from({ length: LOTTERY_CONSTANTS.redMaximum }, () => 0);
  const blue = Array.from({ length: LOTTERY_CONSTANTS.blueMaximum }, () => 0);
  let totalWeight = 0;
  draws.forEach((draw, index) => {
    const weight = Math.pow(0.975, draws.length - 1 - index);
    totalWeight += weight;
    draw.redNumbers.forEach((number) => (red[number - 1] += weight));
    blue[draw.blueNumber - 1] += weight;
  });
  const redBaseline = LOTTERY_CONSTANTS.redCount / LOTTERY_CONSTANTS.redMaximum;
  const blueBaseline = 1 / LOTTERY_CONSTANTS.blueMaximum;
  return {
    red: red.map(
      (count) => (count + redBaseline * 16) / (totalWeight + 16) / redBaseline,
    ),
    blue: blue.map(
      (count) =>
        (count + blueBaseline * 16) / (totalWeight + 16) / blueBaseline,
    ),
  };
}

function countFrequencies(
  draws: readonly DrawRecord[],
  maximum: number,
  values: (draw: DrawRecord) => readonly number[],
): BallFrequency[] {
  const counts = Array.from({ length: maximum }, () => 0);
  draws.forEach((draw) =>
    values(draw).forEach((number) => (counts[number - 1] += 1)),
  );
  return counts.map((count, index) => ({
    number: index + 1,
    count,
    rate: draws.length ? count / draws.length : 0,
  }));
}

function chiSquare(
  frequencies: readonly BallFrequency[],
  expected: number,
): number {
  if (!expected) return 0;
  return frequencies.reduce(
    (total, item) => total + Math.pow(item.count - expected, 2) / expected,
    0,
  );
}

function calculateFrequentPairs(draws: readonly DrawRecord[]): AuditPair[] {
  const counts = buildPairCounts(draws);
  return [...counts.entries()]
    .map(([key, count]) => {
      const [first, second] = key.split("-").map(Number);
      return { first, second, count };
    })
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.first - right.first ||
        left.second - right.second,
    )
    .slice(0, 5);
}

function buildPairCounts(draws: readonly DrawRecord[]): Map<string, number> {
  const pairs = new Map<string, number>();
  draws.forEach((draw) =>
    allPairs(draw.redNumbers).forEach(([first, second]) => {
      const key = pairKey(first, second);
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }),
  );
  return pairs;
}

function allPairs(numbers: readonly number[]): [number, number][] {
  const result: [number, number][] = [];
  for (let index = 0; index < numbers.length; index += 1)
    for (let next = index + 1; next < numbers.length; next += 1)
      result.push([numbers[index], numbers[next]]);
  return result;
}

function pairKey(first: number, second: number): string {
  return first < second ? `${first}-${second}` : `${second}-${first}`;
}

function takeUniformNumbers(
  maximum: number,
  count: number,
  random: RandomSource,
): number[] {
  const numbers = Array.from({ length: maximum }, (_, index) => index + 1);
  for (let index = 0; index < count; index += 1) {
    const swapIndex =
      index + Math.floor(random.next() * (numbers.length - index));
    [numbers[index], numbers[swapIndex]] = [numbers[swapIndex], numbers[index]];
  }
  return numbers.slice(0, count).sort((left, right) => left - right);
}

function pickWeightedIndex(
  weights: readonly number[],
  random: RandomSource,
): number {
  const normalized = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0.0001,
  );
  const sum = normalized.reduce((total, weight) => total + weight, 0);
  let cursor = random.next() * sum;
  for (let index = 0; index < normalized.length; index += 1) {
    cursor -= normalized[index];
    if (cursor <= 0) return index;
  }
  return normalized.length - 1;
}

function combinationKey(
  combination: Pick<LotteryCombination, "redNumbers" | "blueNumber">,
): string {
  return `${combination.redNumbers.join("-")}|${combination.blueNumber}`;
}

function cloneCombination(combination: LotteryCombination): LotteryCombination {
  return {
    redNumbers: [...combination.redNumbers],
    blueNumber: combination.blueNumber,
    score: combination.score,
  };
}

function formatNumbers(numbers: readonly number[]): string {
  return numbers.map(formatNumber).join(" ");
}

function formatNumber(number: number): string {
  return String(number).padStart(2, "0");
}

function createRandom(seed: number): RandomSource {
  let value = seed >>> 0;
  return {
    next: () => {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
}
