const MASK64 = (1n << 64n) - 1n;
const u = (x: bigint): bigint => x & MASK64;

const NPOWERS = 87;
const STEPPOWERS = 8;
const FIRSTPOWER = -348;
const EXPMAX = -32;
const EXPMIN = -60;
const FRACMASK = 0x000fffffffffffffn;
const EXPMASK = 0x7ff0000000000000n;
const HIDDENBIT = 0x0010000000000000n;
const SIGNMASK = 0x8000000000000000n;
const EXPBIAS = 1023 + 52;
const LOMASK = 0x00000000ffffffffn;

interface Fp {
  frac: bigint;
  exp: number;
}

const POWERS_TEN: ReadonlyArray<readonly [bigint, number]> = [
  [18054884314459144840n, -1220],
  [13451937075301367670n, -1193],
  [10022474136428063862n, -1166],
  [14934650266808366570n, -1140],
  [11127181549972568877n, -1113],
  [16580792590934885855n, -1087],
  [12353653155963782858n, -1060],
  [18408377700990114895n, -1034],
  [13715310171984221708n, -1007],
  [10218702384817765436n, -980],
  [15227053142812498563n, -954],
  [11345038669416679861n, -927],
  [16905424996341287883n, -901],
  [12595523146049147757n, -874],
  [9384396036005875287n, -847],
  [13983839803942852151n, -821],
  [10418772551374772303n, -794],
  [15525180923007089351n, -768],
  [11567161174868858868n, -741],
  [17236413322193710309n, -715],
  [12842128665889583758n, -688],
  [9568131466127621947n, -661],
  [14257626930069360058n, -635],
  [10622759856335341974n, -608],
  [15829145694278690180n, -582],
  [11793632577567316726n, -555],
  [17573882009934360870n, -529],
  [13093562431584567480n, -502],
  [9755464219737475723n, -475],
  [14536774485912137811n, -449],
  [10830740992659433045n, -422],
  [16139061738043178685n, -396],
  [12024538023802026127n, -369],
  [17917957937422433684n, -343],
  [13349918974505688015n, -316],
  [9946464728195732843n, -289],
  [14821387422376473014n, -263],
  [11042794154864902060n, -236],
  [16455045573212060422n, -210],
  [12259964326927110867n, -183],
  [18268770466636286478n, -157],
  [13611294676837538539n, -130],
  [10141204801825835212n, -103],
  [15111572745182864684n, -77],
  [11258999068426240000n, -50],
  [16777216000000000000n, -24],
  [12500000000000000000n, 3],
  [9313225746154785156n, 30],
  [13877787807814456755n, 56],
  [10339757656912845936n, 83],
  [15407439555097886824n, 109],
  [11479437019748901445n, 136],
  [17105694144590052135n, 162],
  [12744735289059618216n, 189],
  [9495567745759798747n, 216],
  [14149498560666738074n, 242],
  [10542197943230523224n, 269],
  [15709099088952724970n, 295],
  [11704190886730495818n, 322],
  [17440603504673385349n, 348],
  [12994262207056124023n, 375],
  [9681479787123295682n, 402],
  [14426529090290212157n, 428],
  [10748601772107342003n, 455],
  [16016664761464807395n, 481],
  [11933345169920330789n, 508],
  [17782069995880619868n, 534],
  [13248674568444952270n, 561],
  [9871031767461413346n, 588],
  [14708983551653345445n, 614],
  [10959046745042015199n, 641],
  [16330252207878254650n, 667],
  [12166986024289022870n, 694],
  [18130221999122236476n, 720],
  [13508068024458167312n, 747],
  [10064294952495520794n, 774],
  [14996968138956309548n, 800],
  [11173611982879273257n, 827],
  [16649979327439178909n, 853],
  [12405201291620119593n, 880],
  [9242595204427927429n, 907],
  [13772540099066387757n, 933],
  [10261342003245940623n, 960],
  [15290591125556738113n, 986],
  [11392378155556871081n, 1013],
  [16975966327722178521n, 1039],
  [12648080533535911531n, 1066],
];

const TENS: readonly bigint[] = [
  10000000000000000000n,
  1000000000000000000n,
  100000000000000000n,
  10000000000000000n,
  1000000000000000n,
  100000000000000n,
  10000000000000n,
  1000000000000n,
  100000000000n,
  10000000000n,
  1000000000n,
  100000000n,
  10000000n,
  1000000n,
  100000n,
  10000n,
  1000n,
  100n,
  10n,
  1n,
];

function buildFp(d: number): Fp {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, d);
  const bits = view.getBigUint64(0);
  let frac = bits & FRACMASK;
  let exp = Number((bits & EXPMASK) >> 52n);
  if (exp !== 0) {
    frac += HIDDENBIT;
    exp -= EXPBIAS;
  } else {
    exp = -EXPBIAS + 1;
  }
  return { frac, exp };
}

function normalize(fp: Fp): Fp {
  let frac = fp.frac;
  let exp = fp.exp;
  while ((frac & HIDDENBIT) === 0n) {
    frac = u(frac << 1n);
    exp--;
  }
  const shift = 64 - 52 - 1;
  frac = u(frac << BigInt(shift));
  exp -= shift;
  return { frac, exp };
}

function normalizedBoundaries(fp: Fp): { lower: Fp; upper: Fp } {
  let upperFrac = u((fp.frac << 1n) + 1n);
  let upperExp = fp.exp - 1;
  while ((upperFrac & (HIDDENBIT << 1n)) === 0n) {
    upperFrac = u(upperFrac << 1n);
    upperExp--;
  }
  const uShift = 64 - 52 - 2;
  upperFrac = u(upperFrac << BigInt(uShift));
  upperExp -= uShift;

  const lShift = fp.frac === HIDDENBIT ? 2 : 1;
  let lowerFrac = u((fp.frac << BigInt(lShift)) - 1n);
  let lowerExp = fp.exp - lShift;
  lowerFrac = u(lowerFrac << BigInt(lowerExp - upperExp));
  lowerExp = upperExp;
  return { lower: { frac: lowerFrac, exp: lowerExp }, upper: { frac: upperFrac, exp: upperExp } };
}

function multiply(a: Fp, b: Fp): Fp {
  const ahBl = (a.frac >> 32n) * (b.frac & LOMASK);
  const alBh = (a.frac & LOMASK) * (b.frac >> 32n);
  const alBl = (a.frac & LOMASK) * (b.frac & LOMASK);
  const ahBh = (a.frac >> 32n) * (b.frac >> 32n);
  let tmp = (ahBl & LOMASK) + (alBh & LOMASK) + (alBl >> 32n);
  tmp += 1n << 31n;
  return {
    frac: u(ahBh + (ahBl >> 32n) + (alBh >> 32n) + (tmp >> 32n)),
    exp: a.exp + b.exp + 64,
  };
}

function findCachedPow10(exp: number): { cached: Fp; k: number } {
  const oneLogTen = 0.30102999566398114;
  const approx = Math.trunc(-(exp + NPOWERS) * oneLogTen);
  let idx = Math.trunc((approx - FIRSTPOWER) / STEPPOWERS);
  for (;;) {
    const current = exp + POWERS_TEN[idx]![1] + 64;
    if (current < EXPMIN) {
      idx++;
      continue;
    }
    if (current > EXPMAX) {
      idx--;
      continue;
    }
    return { cached: { frac: POWERS_TEN[idx]![0], exp: POWERS_TEN[idx]![1] }, k: FIRSTPOWER + idx * STEPPOWERS };
  }
}

function roundDigit(digits: number[], ndigits: number, delta: bigint, rem0: bigint, kappa: bigint, frac: bigint): void {
  let rem = rem0;
  while (rem < frac && u(delta - rem) >= kappa && (u(rem + kappa) < frac || u(frac - rem) > u(rem + kappa - frac))) {
    digits[ndigits - 1] = digits[ndigits - 1]! - 1;
    rem = u(rem + kappa);
  }
}

function generateDigits(fp: Fp, upper: Fp, lower: Fp, K: { value: number }): number[] {
  const wfrac = u(upper.frac - fp.frac);
  let delta = u(upper.frac - lower.frac);
  const oneFrac = 1n << BigInt(-upper.exp);
  const oneExp = upper.exp;
  let part1 = upper.frac >> BigInt(-oneExp);
  let part2 = upper.frac & (oneFrac - 1n);
  const digits: number[] = [];
  let kappa = 10;
  for (let i = 10; kappa > 0; i++) {
    const div = TENS[i]!;
    const digit = part1 / div;
    if (digit !== 0n || digits.length > 0) digits.push(Number(digit));
    part1 = u(part1 - digit * div);
    kappa--;
    const tmp = u(u(part1 << BigInt(-oneExp)) + part2);
    if (tmp <= delta) {
      K.value += kappa;
      roundDigit(digits, digits.length, delta, tmp, u(div << BigInt(-oneExp)), wfrac);
      return digits;
    }
  }
  let unit = 18;
  for (;;) {
    part2 = u(part2 * 10n);
    delta = u(delta * 10n);
    kappa--;
    const digit = Number(u(part2 >> BigInt(-oneExp)));
    if (digit !== 0 || digits.length > 0) digits.push(digit);
    part2 &= oneFrac - 1n;
    if (part2 < delta) {
      K.value += kappa;
      roundDigit(digits, digits.length, delta, part2, oneFrac, u(wfrac * TENS[unit]!));
      return digits;
    }
    unit--;
  }
}

function grisu2(d: number): { digits: number[]; K: number } {
  const w0 = buildFp(d);
  const { lower, upper } = normalizedBoundaries(w0);
  const w = normalize(w0);
  const { cached, k } = findCachedPow10(upper.exp);
  const wm = multiply(w, cached);
  const um = multiply(upper, cached);
  const lm = multiply(lower, cached);
  lm.frac = u(lm.frac + 1n);
  um.frac = u(um.frac - 1n);
  const K = { value: -k };
  const digits = generateDigits(wm, um, lm, K);
  return { digits, K: K.value };
}

export function formatJsonFloat(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const sign = value < 0 ? "-" : "";
  const { digits, K } = grisu2(value);
  const text = digits.join("");
  const ndigits = digits.length;
  const exp = Math.abs(K + ndigits - 1);

  if (K >= 0 && exp < 15) return `${sign}${text}${"0".repeat(K)}.0`;
  if (K < 0 && (K > -7 || exp < 10)) {
    const offset = ndigits - Math.abs(K);
    if (offset <= 0) return `${sign}0.${"0".repeat(-offset)}${text}`;
    return `${sign}${text.slice(0, offset)}.${text.slice(offset)}`;
  }
  const mantissa = ndigits > 1 ? `${text[0]}.${text.slice(1)}` : text;
  const e = K + ndigits - 1;
  return `${sign}${mantissa}e${e < 0 ? "-" : "+"}${exp}`;
}
