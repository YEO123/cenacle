const REGIONS = {
  'Île-de-France': '75 77 78 91 92 93 94 95',
  'Centre-Val de Loire': '18 28 36 37 41 45',
  'Bourgogne-Franche-Comté': '21 25 39 58 70 71 89 90',
  Normandie: '14 27 50 61 76',
  'Hauts-de-France': '02 59 60 62 80',
  'Grand Est': '08 10 51 52 54 55 57 67 68 88',
  'Pays de la Loire': '44 49 53 72 85',
  Bretagne: '22 29 35 56',
  'Nouvelle-Aquitaine': '16 17 19 23 24 33 40 47 64 79 86 87',
  Occitanie: '09 11 12 30 31 32 34 46 48 65 66 81 82',
  'Auvergne-Rhône-Alpes': '01 03 07 15 26 38 42 43 63 69 73 74',
  "Provence-Alpes-Côte d'Azur": '04 05 06 13 83 84',
  Corse: '20',
  'Outre-mer': '97 98',
};

const DEPT_REGION = new Map(
  Object.entries(REGIONS).flatMap(([region, depts]) => depts.split(' ').map((d) => [d, region]))
);
const CP_RENNES = new Set(['35000', '35200', '35700']);

export const normalize = (s) =>
  String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function zoneOf({ pays, code_postal: cp, ville }) {
  if (pays !== 'FR') return 'Étranger';
  if (CP_RENNES.has(cp) || normalize(ville) === 'rennes') return 'Rennes';
  const region = DEPT_REGION.get(String(cp).slice(0, 2)) ?? 'Région inconnue';
  return region === 'Bretagne' ? 'Bretagne (hors Rennes)' : region;
}
