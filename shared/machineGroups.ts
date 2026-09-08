export interface MachineGroup {
  id: 'impresion' | 'laminacion' | 'rebobinado';
  label: string;
  machines: string[];
}

/**
 * Grupos usados por los filtros operativos y por el reporte semanal.
 * Centralizarlos evita que el correo y el Dashboard clasifiquen una máquina
 * en líneas distintas.
 */
export const MACHINE_GROUPS: MachineGroup[] = [
  {
    id: 'impresion',
    label: 'Impresión',
    machines: ['WH1', 'WH3', 'Giave'],
  },
  {
    id: 'laminacion',
    label: 'Laminación',
    machines: ['NEXUS', 'SL2', 'SL2 EVO'],
  },
  {
    id: 'rebobinado',
    label: 'Rebobinado',
    machines: ['S2DT', '21', '22', 'PROSLIT'],
  },
];
