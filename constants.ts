import { MachineType, ShiftType, BossType } from './types';

export const MACHINES = Object.values(MachineType);
export const SHIFTS = Object.values(ShiftType);
export const BOSSES = Object.values(BossType);

export const COMMON_COMMENTS = [
  "Antivaho",
  "NT",
  "No tejido",
  "Montado",
  "Pedidos",
  "Cambio carro",
  "Bio",
  "Papel"
];

// Start clean. Logic in storageService will handle removal of old test data if present in DB.
export const COMMON_OPERATORS: string[] = [];

// Empty array, no mock data
export const INITIAL_DATA_SEED = [];