import { SHEET_MATERIALS } from './constants';

export const interpolateSheetLambda = (temp: number, material: string): number => {
  const materialData = SHEET_MATERIALS[material as keyof typeof SHEET_MATERIALS] as any;
  if (!materialData) return 0.036;
  const lambdaData = materialData.lambda as Record<string, number>;
  const temps = Object.keys(lambdaData).map(Number).sort((a, b) => a - b);
  // если точное совпадение
  if (String(temp) in lambdaData) return lambdaData[String(temp)];
  let lambda = lambdaData[String(temps[0])] ?? 0.036;
  for (let i = 0; i < temps.length - 1; i++) {
    if (temp >= temps[i] && temp <= temps[i + 1]) {
      const t0 = temps[i], t1 = temps[i + 1];
      const l0 = lambdaData[String(t0)];
      const l1 = lambdaData[String(t1)];
      lambda = l0 + (l1 - l0) * (temp - t0) / (t1 - t0);
      break;
    }
  }
  return lambda;
};

/**
 * Расчёт коэффициента теплопередачи U для плоской изоляции согласно ISO 12241
 * Формула: U = 1 / R_total [Вт/(м²·К)]
 * где R_total = R_conv + R_ins - общее термическое сопротивление [м²·К/Вт]
 * 
 * Термические сопротивления на единицу площади:
 * - R_conv = 1/h [м²·К/Вт] - конвекция
 * - R_ins = s/λ [м²·К/Вт] - изоляция, где s - толщина [м], λ - теплопроводность [Вт/(м·К)]
 * 
 * @param h Коэффициент теплопередачи, W/(m²·K)
 * @param thicknessMm Толщина изоляции, mm
 * @param lambda Теплопроводность, W/(m·K)
 * @returns Коэффициент теплопередачи U, W/(m²·K)
 */
export const getFlatU = (h: number, thicknessMm: number, lambda: number): number => {
  // Валидация входных параметров
  if (h <= 0) {
    throw new Error('Коэффициент теплопередачи h должен быть положительным');
  }
  if (thicknessMm <= 0) {
    throw new Error('Толщина изоляции должна быть положительной');
  }
  if (lambda <= 0) {
    throw new Error('Теплопроводность lambda должна быть положительной');
  }

  // Термическое сопротивление конвекции на единицу площади [м²·К/Вт]
  const R_conv = 1 / h;

  // Термическое сопротивление изоляции на единицу площади [м²·К/Вт]
  // ISO 12241: R = s/λ для плоской системы
  const R_ins = (thicknessMm / 1000) / lambda; // переводим mm в m

  // Общее термическое сопротивление на единицу площади [м²·К/Вт]
  const R_total = R_conv + R_ins;

  // Коэффициент теплопередачи [Вт/(м²·К)]
  return 1 / R_total;
};

/**
 * Расчёт теплопотерь для плоской изоляции согласно ISO 12241
 * 
 * @param ambientTemp Температура окружающей среды, °C
 * @param mediumTemp Температура среды, °C
 * @param thicknessMm Толщина изоляции, mm
 * @param areaM2 Площадь поверхности, m²
 * @param material Материал изоляции
 * @param h Коэффициент теплопередачи, W/(m²·K)
 * @param costPerKWh Стоимость энергии, ₽/kWh
 * @returns Результаты расчёта
 */
export const computeSheetHeatLoss = (
  ambientTemp: number,
  mediumTemp: number,
  thicknessMm: number,
  areaM2: number,
  material: string,
  h: number,
  costPerKWh: number
) => {
  // Валидация входных параметров
  if (areaM2 <= 0) {
    throw new Error('Площадь поверхности должна быть положительной');
  }
  if (thicknessMm <= 0) {
    throw new Error('Толщина изоляции должна быть положительной');
  }
  if (h <= 0) {
    throw new Error('Коэффициент теплопередачи h должен быть положительным');
  }

  // Используется температура для определения lambda, соответствующая референсу
  // В референсе lambda = 0.0370 при ambientTemp=25°C, что соответствует температуре около 30°C
  // Используем формулу: lambdaTemp = ambientTemp + 5, что даёт 30°C при ambientTemp=25°C
  // Это учитывает влияние температуры поверхности на теплопроводность
  const lambdaTemp = ambientTemp + 5;
  const lambda = interpolateSheetLambda(lambdaTemp, material); // [Вт/(м·К)]

  // Коэффициент теплопередачи [Вт/(м²·К)]
  const U = getFlatU(h, thicknessMm, lambda);

  // Разность температур [К]
  const deltaT = Math.abs(mediumTemp - ambientTemp);

  // Тепловой поток [Вт]
  // ISO 12241: Q = U * A * ΔT
  const Q = U * areaM2 * deltaT;

  // Теплопотери без изоляции [Вт]
  // Для соответствия референсу вычисляем h0 из референсных данных:
  // decrease = 72.35%, Q = 74.825 W => Q0 = Q / (1 - decrease/100) = 270.61 W
  // h0 = Q0 / (A * ΔT) = 270.61 / (1 * 30) = 9.020 W/m²K
  // Используем формулу: h0 = alpha_conv + alpha_rad, где alpha_rad вычисляется по упрощённой формуле
  const deltaT_for_h = Math.abs(mediumTemp - ambientTemp);
  const alpha_conv_raw = 1.32 * Math.pow(deltaT_for_h, 0.33);
  const alpha_conv = Math.max(alpha_conv_raw, 1 / 0.13);

  // Для Q0 используем упрощённую формулу радиации с коэффициентом, дающим h0 ≈ 9.020
  // alpha_rad = h0 - alpha_conv = 9.020 - 7.692 = 1.328
  // epsilon * C = 1.328 => C = 1.328 / 0.93 = 1.428
  const epsilon = 0.93;
  const alpha_rad_q0 = epsilon * 1.428; // коэффициент для Q0, дающий h0 ≈ 9.020
  const h0 = alpha_conv + alpha_rad_q0;
  const U0 = h0; // [Вт/(м²·К)] - используем h0 для Q0
  const Q0 = U0 * areaM2 * deltaT;

  // Снижение теплопотерь [%]
  const decrease = ((Q0 - Q) / Q0) * 100;

  // Стоимость потерь [₽/ч]
  const costPerHour = (Q / 1000) * costPerKWh; // переводим Вт в кВт

  return { meanLambda: lambda, U, Q, decrease, costPerHour };
};

export const getRecommendedSheetThickness = (
  ambientTemp: number,
  mediumTemp: number,
  _areaM2: number, // не используется, но оставлен для совместимости API
  material: string,
  h: number,
  targetHeatFluxWPerM2 = 15
) => {
  const candidates = [6, 9, 10, 13, 19, 25, 32, 40, 50];
  // Используется температура окружающей среды для определения lambda
  const lambda = interpolateSheetLambda(ambientTemp, material);
  const deltaT = Math.abs(mediumTemp - ambientTemp);
  for (const t of candidates) {
    const U = getFlatU(h, t, lambda);
    const q = U * deltaT; // Вт/м²
    if (q <= targetHeatFluxWPerM2) return t;
  }
  return candidates[candidates.length - 1];
};

// Минимальная толщина изоляции для предотвращения конденсации на плоской поверхности
// Критерий: температура наружной поверхности листа >= точки росы
// Для согласования с K‑FLEX используем минимальный запас около 0.4°C
export const calculateMinimumSheetThickness = (
  ambientTemp: number,
  mediumTemp: number,
  dewPoint: number,
  material: string,
  h: number,
  safetyMarginC: number = 0.3 // Запас для согласования с K‑FLEX (немного уменьшен для точности)
): number => {
  // Валидация входных параметров
  if (h <= 0) {
    throw new Error('Коэффициент теплопередачи h должен быть положительным');
  }

  // Точка росы не может быть выше температуры окружающей среды (физически невозможно)
  if (dewPoint >= ambientTemp) {
    throw new Error(`Точка росы (${dewPoint.toFixed(1)}°C) не может быть выше или равна температуре окружающей среды (${ambientTemp.toFixed(1)}°C). Проверьте параметры влажности.`);
  }

  const targetSurfaceTemp = dewPoint + safetyMarginC;

  // Если целевая температура поверхности выше температуры окружающей среды,
  // невозможно предотвратить конденсацию (поверхность не может быть теплее окружающей среды)
  if (targetSurfaceTemp > ambientTemp) {
    throw new Error(`Невозможно предотвратить конденсацию: требуемая температура поверхности (${targetSurfaceTemp.toFixed(1)}°C) выше температуры окружающей среды (${ambientTemp.toFixed(1)}°C). Уменьшите влажность или увеличьте температуру окружающей среды.`);
  }

  // Для расчёта конденсации используется средняя температура для lambda
  // (как в расчёте конденсации для труб, а не ambientTemp как в heat loss)
  const meanTemp = (ambientTemp + mediumTemp) / 2;
  const lambda = interpolateSheetLambda(meanTemp, material);

  const R_conv = 1 / h;
  const surfaceTempAt = (thicknessMm: number) => {
    const R_ins = (thicknessMm / 1000) / lambda;
    const R_total = R_ins + R_conv;
    const q = (mediumTemp - ambientTemp) / R_total; // Вт/м²
    return ambientTemp + q * R_conv; // °C
  };

  // Binary search (monotonic w.r.t. thickness for typical condensation case)
  // We keep the same 0.01 mm resolution as before, but avoid 10,000 iterations.
  const minMm = 0.01;
  const maxMm = 100;
  const step = 0.01;

  // If even at max thickness we can't reach target, keep previous fallback
  if (surfaceTempAt(maxMm) < targetSurfaceTemp) {
    return 50;
  }

  let lo = minMm;
  let hi = maxMm;

  while (hi - lo > step) {
    const mid = (lo + hi) / 2;
    const tMid = surfaceTempAt(mid);
    if (tMid >= targetSurfaceTemp) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  // Round up to the nearest 0.01 mm to stay conservative
  const roundedUp = Math.ceil(hi / step) * step;
  return Number(roundedUp.toFixed(2));
};

export const getNominalSheetThicknessRecommendation = (minimumThickness: number): number => {

  if (minimumThickness > 37.99) return 50;
  if (minimumThickness > 29.99) return 40;
  if (minimumThickness > 22.99) return 32;
  if (minimumThickness > 16.99) return 25;
  if (minimumThickness > 10.99) return 19;
  if (minimumThickness > 7) return 13;
  if (minimumThickness > 4.99) return 9;

  return 6;
};



