import React, { useState, useEffect, useRef } from 'react';
import { Plus, Save, Calendar, CheckCircle, X, ChevronDown, Trash2, RotateCcw, Users, Cloud, WifiOff } from 'lucide-react';
import { MachineFieldDefinition, MachineType, ShiftType, ProductionRecord } from '../types';
import { MACHINES, SHIFTS } from '../constants';
import { 
  saveRecord, 
  refreshSettings,
  subscribeToSettings,
  subscribeToMachineFieldSchema,
  UserOption
} from '../services/storageService';
import { useAuth } from '../context/AuthContext';

interface ShiftFormProps {
  onRecordSaved: () => void;
  editingRecord?: ProductionRecord | null;
  onCancelEdit?: () => void;
}

type FocusableFieldElement = HTMLInputElement | HTMLSelectElement;

const MAX_PG_INT = 2147483647;
const getStorageKey = (userId?: string | null) => `pigmea_form_defaults_v1_${userId || 'guest'}`;

const sanitizeSchemaVersion = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > MAX_PG_INT) {
    return 1;
  }
  return numeric;
};

const ShiftForm: React.FC<ShiftFormProps> = ({ onRecordSaved, editingRecord, onCancelEdit }) => {
  const { user } = useAuth();

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    shift: ShiftType.MORNING,
    bossUserId: '',
    machine: MachineType.WH1,
  });

  // Custom Operator Field State
  const [operatorInput, setOperatorInput] = useState('');
  const [operatorUserId, setOperatorUserId] = useState<string | null>(null);
  const [availableOperatorOptions, setAvailableOperatorOptions] = useState<UserOption[]>([]);
  const [availableBossOptions, setAvailableBossOptions] = useState<UserOption[]>([]);
  const [filteredOperators, setFilteredOperators] = useState<UserOption[]>([]);
  const [showOperatorSuggestions, setShowOperatorSuggestions] = useState(false);
  const operatorDropdownRef = useRef<HTMLDivElement>(null);
  // Tracks when the user has intentionally opened the picker (prevents subscription from re-filling the field)
  const operatorPickingRef = useRef(false);
  // True after localStorage defaults have been loaded — prevents the subscription callback from overriding them
  const defaultsLoadedRef = useRef(false);

  // Custom Comment Field State
  const [commentInput, setCommentInput] = useState('');
  const [availableComments, setAvailableComments] = useState<string[]>([]);
  const [filteredComments, setFilteredComments] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Success Modal State
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [wasOfflineSave, setWasOfflineSave] = useState(false);
  const [machineFields, setMachineFields] = useState<MachineFieldDefinition[]>([]);
  const [machineSchemaVersion, setMachineSchemaVersion] = useState<number>(1);
  const [dynamicFieldValues, setDynamicFieldValues] = useState<Record<string, unknown>>({});
  const [dynamicFieldError, setDynamicFieldError] = useState('');
  const [isMachineSchemaReady, setIsMachineSchemaReady] = useState(false);
  const focusableFieldRefs = useRef<Record<string, FocusableFieldElement | null>>({});

  // 1. Load Defaults from LocalStorage when the user is identified (per-user key)
  useEffect(() => {
    defaultsLoadedRef.current = false; // reset on user change
    if (!editingRecord && user?.id) {
      const savedDefaults = localStorage.getItem(getStorageKey(user.id));
      if (savedDefaults) {
        try {
          const parsed = JSON.parse(savedDefaults);
          // Mark BEFORE state updates so the subscription callback sees it synchronously
          defaultsLoadedRef.current = true;
          setFormData(prev => ({
            ...prev,
            date: parsed.date || prev.date,
            shift: parsed.shift || prev.shift,
            bossUserId: parsed.bossUserId || prev.bossUserId,
            machine: parsed.machine || prev.machine
          }));
          if (parsed.operator) setOperatorInput(parsed.operator);
          if (parsed.operatorUserId) setOperatorUserId(parsed.operatorUserId);
        } catch (e) {
          console.error("Error loading saved defaults", e);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]); // Run when the logged-in user is identified

  useEffect(() => {
    if (availableBossOptions.length === 0) {
      return;
    }

    const selectedBossStillAvailable = availableBossOptions.some((boss) => boss.id === formData.bossUserId);
    if (!formData.bossUserId || !selectedBossStillAvailable) {
      setFormData((prev) => ({ ...prev, bossUserId: availableBossOptions[0].id }));
    }
  }, [availableBossOptions, formData.bossUserId]);

  // 2. Save Defaults to LocalStorage whenever context fields change (per-user key, only if not editing)
  useEffect(() => {
    if (!editingRecord && user?.id) {
      const defaultsToSave = {
        date: formData.date,
        shift: formData.shift,
        bossUserId: formData.bossUserId,
        machine: formData.machine,
        operator: operatorInput,
        operatorUserId
      };
      localStorage.setItem(getStorageKey(user.id), JSON.stringify(defaultsToSave));
    }
  }, [formData.date, formData.shift, formData.bossUserId, formData.machine, operatorInput, operatorUserId, editingRecord, user?.id]);

  // Load editing data when record changes
  useEffect(() => {
    if (editingRecord) {
      setFormData({
        date: editingRecord.date,
        shift: editingRecord.shift,
        bossUserId: editingRecord.bossUserId || '',
        machine: editingRecord.machine,
      });
      setCommentInput(editingRecord.changesComment || '');
      setOperatorInput(editingRecord.operator || '');
      setOperatorUserId(editingRecord.operatorUserId || null);
      setDynamicFieldValues(editingRecord.dynamicFieldsValues || {});
      // Scroll to top when editing starts
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      // Leaving edit mode — restore last persisted context so the operator/machine are not lost
      setCommentInput('');
      setDynamicFieldValues({});
      if (user?.id) {
        const saved = localStorage.getItem(getStorageKey(user.id));
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            setOperatorInput(parsed.operator || '');
            setOperatorUserId(parsed.operatorUserId || null);
          } catch {
            setOperatorUserId(null);
          }
        } else {
          setOperatorUserId(null);
        }
      } else {
        setOperatorUserId(null);
      }
    }
  }, [editingRecord]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to real-time updates for Comments and Operators
  useEffect(() => {
    const unsubscribe = subscribeToSettings((comments, _operators, _bosses, operatorOptions, bossOptions) => {
      setAvailableComments(comments);
      setAvailableOperatorOptions(operatorOptions);
      const isShiftBoss = user?.role === 'jefe_turno';
      const filteredBossOptions = isShiftBoss
        ? (() => {
            const ownBossOption = bossOptions.find((option) => option.id === user?.id);
            if (ownBossOption) {
              return [ownBossOption];
            }
            if (user?.id && user?.name) {
              return [{ id: user.id, name: user.name, role: user.role }];
            }
            return [];
          })()
        : bossOptions;

      setAvailableBossOptions(filteredBossOptions);

      if (!editingRecord && !formData.bossUserId && !defaultsLoadedRef.current && filteredBossOptions.length > 0) {
        setFormData((prev) => ({ ...prev, bossUserId: filteredBossOptions[0].id }));
      }

      if (!editingRecord) {
        if (!operatorPickingRef.current && !defaultsLoadedRef.current && !operatorInput && !operatorUserId && operatorOptions.length > 0) {
          setOperatorInput(operatorOptions[0].name);
          setOperatorUserId(operatorOptions[0].id);
        } else if (!operatorPickingRef.current && operatorInput && !operatorUserId) {
          const normalizedInput = operatorInput.trim().toLowerCase();
          const matchedOperator = operatorOptions.find((option) => option.name.trim().toLowerCase() === normalizedInput);
          if (matchedOperator) {
            setOperatorInput(matchedOperator.name);
            setOperatorUserId(matchedOperator.id);
          }
        }
      }

      if (editingRecord && editingRecord.boss && !formData.bossUserId) {
        const matchedBoss = filteredBossOptions.find((option) => option.name === editingRecord.boss);
        if (matchedBoss) {
          setFormData((prev) => ({ ...prev, bossUserId: matchedBoss.id }));
        }
      }

      if (editingRecord && editingRecord.operator && !operatorUserId) {
        const matchedOperator = operatorOptions.find((option) => option.name === editingRecord.operator);
        if (matchedOperator) {
          setOperatorUserId(matchedOperator.id);
        }
      }
    });
    return () => unsubscribe();
    }, [editingRecord, formData.bossUserId, operatorInput, operatorUserId, user?.id, user?.name, user?.role]);

  useEffect(() => {
    setIsMachineSchemaReady(false);
    const unsubscribe = subscribeToMachineFieldSchema(
      formData.machine,
      (schema) => {
        const enabledFields = (schema.fields || []).filter((field) => field.enabled !== false);
        setMachineFields(enabledFields);
        setMachineSchemaVersion(sanitizeSchemaVersion(schema.version));
        setDynamicFieldValues((prev) => {
          const next: Record<string, unknown> = {};
          for (const field of enabledFields) {
            if (prev[field.key] !== undefined) {
              next[field.key] = prev[field.key];
              continue;
            }
            if (editingRecord?.dynamicFieldsValues && editingRecord.dynamicFieldsValues[field.key] !== undefined) {
              next[field.key] = editingRecord.dynamicFieldsValues[field.key];
              continue;
            }
            next[field.key] = getDefaultFieldValue(field);
          }
          return next;
        });
        setDynamicFieldError('');
        setIsMachineSchemaReady(true);
      },
      (message) => {
        setDynamicFieldError(message);
        setIsMachineSchemaReady(false);
      }
    );

    return () => unsubscribe();
  }, [formData.machine, editingRecord?.id]);

  // Filter logic for Comments
  useEffect(() => {
    if (!commentInput) {
      setFilteredComments(availableComments);
    } else {
      const lowerInput = commentInput.toLowerCase();
      setFilteredComments(availableComments.filter(c => 
        c.toLowerCase().includes(lowerInput)
      ));
    }
  }, [commentInput, availableComments]);

  // Filter logic for Operators
  useEffect(() => {
    let operators = availableOperatorOptions;
    if (operatorInput) {
      const lowerInput = operatorInput.toLowerCase();
      operators = operators.filter(o => 
        o.name.toLowerCase().includes(lowerInput)
      );
    }
    // Sort alphabetically
    const sorted = [...operators].sort((a, b) => a.name.localeCompare(b.name));
    setFilteredOperators(sorted);
  }, [operatorInput, availableOperatorOptions]);

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
      if (operatorDropdownRef.current && !operatorDropdownRef.current.contains(event.target as Node)) {
        operatorPickingRef.current = false;
        setShowOperatorSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getDefaultFieldValue = (field: MachineFieldDefinition): unknown => {
    if (field.defaultValue !== undefined) return field.defaultValue;
    if (field.type === 'multi_select') return [];
    return '';
  };

  const validateDynamicFields = (): string | null => {
    for (const field of machineFields.filter((item) => item.enabled !== false)) {
      const raw = dynamicFieldValues[field.key];
      const hasValue = raw !== undefined && raw !== null && raw !== '' && (!Array.isArray(raw) || raw.length > 0);
      if (field.required && !hasValue) {
        return `El campo ${field.label} es obligatorio.`;
      }

      if (!hasValue) continue;

      if (field.type === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) return `El campo ${field.label} debe ser numérico.`;
        if (field.rules?.min !== undefined && n < field.rules.min) return `El campo ${field.label} no puede ser menor a ${field.rules.min}.`;
        if (field.rules?.max !== undefined && n > field.rules.max) return `El campo ${field.label} no puede ser mayor a ${field.rules.max}.`;
      }

      if (field.type === 'short_text') {
        const text = String(raw);
        if (field.rules?.maxLength !== undefined && text.length > field.rules.maxLength) {
          return `El campo ${field.label} supera ${field.rules.maxLength} caracteres.`;
        }
      }

      if (field.type === 'select') {
        if (!field.options?.includes(String(raw))) {
          return `Selecciona una opción válida para ${field.label}.`;
        }
      }

      if (field.type === 'multi_select') {
        if (!Array.isArray(raw)) {
          return `El campo ${field.label} requiere una selección múltiple.`;
        }
        const invalid = raw.find((item) => !field.options?.includes(String(item)));
        if (invalid) {
          return `El valor ${invalid} no es válido para ${field.label}.`;
        }
      }
    }
    return null;
  };

  const updateDynamicFieldValue = (fieldKey: string, value: unknown) => {
    setDynamicFieldValues((prev) => ({ ...prev, [fieldKey]: value }));
  };

  const setFocusableFieldRef = (fieldKey: string) => (element: FocusableFieldElement | null) => {
    if (element) {
      focusableFieldRefs.current[fieldKey] = element;
      return;
    }

    delete focusableFieldRefs.current[fieldKey];
  };

  const getFocusableFieldOrder = () => {
    const dynamicKeys = machineFields
      .filter((field) => field.type === 'number' || field.type === 'short_text' || field.type === 'select')
      .map((field) => `dynamic:${field.key}`);

    return ['operator', ...dynamicKeys, 'comment'];
  };

  const moveFocusToNextField = (currentFieldKey: string) => {
    const focusableFieldOrder = getFocusableFieldOrder();
    const currentFieldIndex = focusableFieldOrder.indexOf(currentFieldKey);
    const currentField = focusableFieldRefs.current[currentFieldKey];

    if (currentFieldIndex === -1) {
      currentField?.blur();
      return;
    }

    const nextFieldKey = focusableFieldOrder[currentFieldIndex + 1];
    if (!nextFieldKey) {
      currentField?.blur();
      return;
    }

    const nextField = focusableFieldRefs.current[nextFieldKey];
    if (!nextField) {
      currentField?.blur();
      return;
    }

    nextField.focus();
    if (nextField instanceof HTMLInputElement) {
      nextField.select();
    }
  };

  const getEnterKeyHint = (fieldKey: string): 'next' | 'done' => {
    const focusableFieldOrder = getFocusableFieldOrder();
    return focusableFieldOrder[focusableFieldOrder.length - 1] === fieldKey ? 'done' : 'next';
  };

  const handleFieldAdvance = (fieldKey: string) => (event: React.KeyboardEvent<FocusableFieldElement>) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    moveFocusToNextField(fieldKey);
  };

  const moveFocusAfterSelection = (fieldKey: string) => {
    window.setTimeout(() => {
      moveFocusToNextField(fieldKey);
    }, 0);
  };

  const maybeAdvanceTextField = (fieldKey: string, value: string, maxLength?: number) => {
    if (!maxLength || value.length < maxLength) {
      return;
    }

    moveFocusToNextField(fieldKey);
  };

  const preventNumberScrollChange = (e: React.WheelEvent<HTMLInputElement>) => {
    e.currentTarget.blur();
  };

  // --- Comment Handlers ---
  const clearComment = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCommentInput('');
    setFilteredComments(availableComments);
  };

  const handleInputFocus = () => {
    void refreshSettings();
    setShowSuggestions(true);
  };

  const selectComment = (comment: string) => {
    setCommentInput(comment);
    setShowSuggestions(false);
  };

  // --- Operator Handlers ---
  const clearOperator = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOperatorInput('');
    setOperatorUserId(null);
    setFilteredOperators(availableOperatorOptions);
  };

  const handleOperatorFocus = () => {
    operatorPickingRef.current = true;
    setOperatorInput('');
    setOperatorUserId(null);
    setFilteredOperators(availableOperatorOptions);
    setShowOperatorSuggestions(true);
  };

  const selectOperator = (op: UserOption) => {
    operatorPickingRef.current = false;
    setOperatorInput(op.name);
    setOperatorUserId(op.id);
    setShowOperatorSuggestions(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.date) {
      alert('La fecha de turno es obligatoria.');
      return;
    }

    if (!formData.shift) {
      alert('El turno es obligatorio.');
      return;
    }

    if (!formData.machine) {
      alert('La maquina es obligatoria.');
      return;
    }

    if (!formData.bossUserId) {
      alert('El jefe de turno es obligatorio.');
      return;
    }

    const normalizedOperatorInput = operatorInput.trim();
    if (!normalizedOperatorInput) {
      alert('El operario es obligatorio.');
      return;
    }

    if (!isMachineSchemaReady) {
      setDynamicFieldError('Espera un momento: se estan sincronizando los campos de la maquina.');
      return;
    }

    const selectedBoss = availableBossOptions.find((boss) => boss.id === formData.bossUserId);
    if (!selectedBoss) {
      alert('Selecciona un jefe válido desde la lista de usuarios activos.');
      return;
    }

    const selectedOperator = operatorUserId
      ? availableOperatorOptions.find((op) => op.id === operatorUserId)
      : availableOperatorOptions.find((op) => op.name.trim().toLowerCase() === normalizedOperatorInput.toLowerCase());

    if (normalizedOperatorInput && !selectedOperator) {
      alert('Selecciona un operario válido desde la lista de usuarios activos.');
      return;
    }
    if (selectedOperator && operatorUserId !== selectedOperator.id) {
      setOperatorUserId(selectedOperator.id);
    }

    const dynamicValidationError = validateDynamicFields();
    if (dynamicValidationError) {
      setDynamicFieldError(dynamicValidationError);
      return;
    }
    setDynamicFieldError('');

    const id = editingRecord ? editingRecord.id : crypto.randomUUID();
    const timestamp = Date.now();

    const normalizedCommentInput = commentInput.trim();

    const newRecord: ProductionRecord = {
      id,
      timestamp,
      date: formData.date,
      shift: formData.shift,
      boss: selectedBoss.name,
      bossUserId: selectedBoss.id,
      machine: formData.machine,
      meters: 0,
      changesCount: 0,
      changesComment: normalizedCommentInput,
      operator: selectedOperator?.name || normalizedOperatorInput,
      operatorUserId: selectedOperator?.id || null,
      dynamicFieldsValues: dynamicFieldValues,
      schemaVersionUsed: machineSchemaVersion
    };

    let saveResult;
    try {
      // Save Logic — passes userId so offline records are queued for sync
      saveResult = await saveRecord(newRecord, user?.id);
    } catch (error: any) {
      const message = String(error?.message || '');
      if (message.toLowerCase().includes('versión vigente') || message.includes('SCHEMA_VERSION_MISMATCH')) {
        setDynamicFieldError('El esquema cambió mientras completabas el formulario. Se recargó la definición, revisa y vuelve a guardar.');
      } else {
        setDynamicFieldError(message || 'No se pudo guardar el registro.');
      }
      return;
    }

    // Trigger Success Modal
    setWasOfflineSave(saveResult?.offline === true);
    setShowSuccessModal(true);

    // Notify Parent
    onRecordSaved();
    
    // Reset Logic
    if (!editingRecord) {
      setCommentInput('');
      // Operator, Boss, Shift, Date, Machine stay the same!
    } else {
       setCommentInput('');
    }
  };

  const closeSuccessModal = () => {
    setShowSuccessModal(false);
    setWasOfflineSave(false);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-20 md:mb-0">
      <div className={`px-6 py-4 flex items-center justify-between ${editingRecord ? 'bg-orange-600' : 'bg-blue-600'}`}>
        <h2 className="text-white font-bold text-lg flex items-center gap-2">
          {editingRecord ? <RotateCcw className="w-5 h-5" /> : <Plus className="w-5 h-5" />} 
          {editingRecord ? 'Modificar Registro' : 'Nuevo Registro'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        
        {/* Row 1: Date and Shift */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" /> Fecha de Turno
            </label>
            <input
              type="date"
              required
              value={formData.date}
              onChange={e => setFormData({ ...formData, date: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium text-slate-700"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Turno</label>
            <div className="relative">
              <select
                required
                value={formData.shift}
                onChange={e => setFormData({ ...formData, shift: e.target.value as ShiftType })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none font-medium"
              >
                {SHIFTS.map(shift => (
                  <option key={shift} value={shift}>{shift}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                <ChevronDown className="w-4 h-4 text-slate-500" />
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Boss and Operator */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-slate-100">
           <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Jefe de Turno</label>
            <div className="relative">
              <select
                required
                value={formData.bossUserId}
                onChange={e => setFormData({ ...formData, bossUserId: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none font-medium"
              >
                {availableBossOptions.length === 0 && <option value="">Sin jefes activos</option>}
                {availableBossOptions.map((boss) => (
                  <option key={boss.id} value={boss.id}>{boss.name}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                <ChevronDown className="w-4 h-4 text-slate-500" />
              </div>
            </div>
          </div>

          <div className="relative" ref={operatorDropdownRef}>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Operario</label>
            <div className="relative w-full">
              <input
                ref={setFocusableFieldRef('operator')}
                type="text"
                required
                placeholder="Selecciona un operario..."
                value={operatorInput}
                onChange={e => {
                  setOperatorInput(e.target.value);
                  setOperatorUserId(null);
                  setShowOperatorSuggestions(true);
                }}
                onFocus={handleOperatorFocus}
                onKeyDown={handleFieldAdvance('operator')}
                enterKeyHint={getEnterKeyHint('operator')}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium appearance-none pr-10"
                autoComplete="off"
              />
              <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none">
                <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${showOperatorSuggestions ? 'rotate-180' : ''}`} />
              </div>

              {showOperatorSuggestions && (
                <div className="absolute z-50 w-full top-full mt-1 bg-white border border-slate-300 rounded-lg shadow-md max-h-60 overflow-y-auto">
                  {filteredOperators.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                      {filteredOperators.map((op, index) => (
                        <div
                          key={`${op.id}-${index}`}
                          onClick={() => selectOperator(op)}
                          className="w-full text-left px-4 py-3 hover:bg-blue-50 active:bg-blue-100 text-slate-700 font-medium transition-colors cursor-pointer"
                        >
                          {op.name}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-3 text-center text-sm text-slate-500">
                      No hay coincidencias
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Machine Selection */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Seleccionar Máquina</label>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-9 gap-2">
            {MACHINES.map(machine => (
              <button
                key={machine}
                type="button"
                onClick={() => setFormData({ ...formData, machine: machine })}
                className={`px-1 py-3 rounded-lg text-xs font-bold transition-all border break-words ${
                  formData.machine === machine
                    ? 'bg-blue-50 text-blue-700 border-blue-400 ring-1 ring-blue-400 shadow-sm'
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700'
                }`}
              >
                {machine}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Campos</h3>
          <p className="mt-1 text-xs text-slate-500">La seccion se reorganiza automaticamente para que en movil y tablet los controles no se compriman ni se desborden.</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {machineFields.map((field) => (
            <div key={field.key} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3">
                <label className="block min-w-0 break-words text-sm font-semibold text-slate-700">
                  {field.label} {field.required ? <span className="text-red-500">*</span> : null}
                </label>
              </div>

              {field.type === 'number' && (
                <input
                  ref={setFocusableFieldRef(`dynamic:${field.key}`)}
                  type="number"
                  value={(dynamicFieldValues[field.key] as number | string | undefined) ?? ''}
                  min={field.rules?.min}
                  max={field.rules?.max}
                  onWheel={preventNumberScrollChange}
                  onChange={(e) => updateDynamicFieldValue(field.key, e.target.value === '' ? '' : Number(e.target.value))}
                  onKeyDown={handleFieldAdvance(`dynamic:${field.key}`)}
                  enterKeyHint={getEnterKeyHint(`dynamic:${field.key}`)}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 font-medium outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}

              {field.type === 'short_text' && (
                <input
                  ref={setFocusableFieldRef(`dynamic:${field.key}`)}
                  type="text"
                  value={(dynamicFieldValues[field.key] as string | undefined) ?? ''}
                  maxLength={field.rules?.maxLength}
                  onChange={(e) => {
                    updateDynamicFieldValue(field.key, e.target.value);
                    maybeAdvanceTextField(`dynamic:${field.key}`, e.target.value, field.rules?.maxLength);
                  }}
                  onKeyDown={handleFieldAdvance(`dynamic:${field.key}`)}
                  enterKeyHint={getEnterKeyHint(`dynamic:${field.key}`)}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 font-medium outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}

              {field.type === 'select' && (
                <div className="relative">
                  <select
                    ref={setFocusableFieldRef(`dynamic:${field.key}`)}
                    value={(dynamicFieldValues[field.key] as string | undefined) ?? ''}
                    onChange={(e) => {
                      updateDynamicFieldValue(field.key, e.target.value);
                      moveFocusAfterSelection(`dynamic:${field.key}`);
                    }}
                    onKeyDown={handleFieldAdvance(`dynamic:${field.key}`)}
                    className="w-full appearance-none rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 pr-10 font-medium outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Selecciona una opción</option>
                    {(field.options || []).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              )}

              {field.type === 'multi_select' && (
                <div className="space-y-3 rounded-xl border border-slate-300 bg-slate-50 px-3 py-3">
                  <p className="text-xs font-medium text-slate-500">Puedes marcar varias opciones.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(field.options || []).map((option) => {
                      const selected = Array.isArray(dynamicFieldValues[field.key])
                        ? (dynamicFieldValues[field.key] as string[])
                        : [];
                      const isChecked = selected.includes(option);
                      return (
                        <label
                          key={option}
                          className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${
                            isChecked
                              ? 'border-blue-300 bg-blue-50 text-blue-700'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-blue-600"
                            checked={isChecked}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) {
                                next.add(option);
                              } else {
                                next.delete(option);
                              }
                              updateDynamicFieldValue(field.key, Array.from(next));
                            }}
                          />
                          <span className="min-w-0 break-words">{option}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="relative xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" ref={dropdownRef}>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Comentario / Incidencia</label>
            <p className="mb-3 text-xs text-slate-500">Selecciona una incidencia existente o escribe una nueva si no aparece en la lista.</p>

            <div className="relative w-full">
              <div className="relative">
                <input
                  ref={setFocusableFieldRef('comment')}
                  type="text"
                  placeholder="Escribir..."
                  value={commentInput}
                  onChange={e => {
                    setCommentInput(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={handleInputFocus}
                  onKeyDown={handleFieldAdvance('comment')}
                  enterKeyHint={getEnterKeyHint('comment')}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 pl-4 pr-10 py-3 text-base font-medium outline-none transition-all focus:ring-2 focus:ring-blue-500 sm:text-lg"
                  autoComplete="off"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
                  {commentInput && (
                    <button type="button" onClick={clearComment} className="mr-1 p-1 text-slate-400 transition-colors hover:text-red-500">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <div className={`pointer-events-none p-1 text-slate-400 transition-transform duration-200 ${showSuggestions ? 'rotate-180' : ''}`}>
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </div>
              </div>

              {showSuggestions && (
                <div className="absolute bottom-full z-50 mb-2 max-h-60 w-full origin-bottom overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl animate-fade-in">
                  {filteredComments.length > 0 ? (
                    <div className="divide-y divide-slate-50">
                      {filteredComments.map((comment, index) => (
                        <div
                          key={index}
                          onClick={() => selectComment(comment)}
                          className="group flex w-full cursor-pointer items-center justify-between px-4 py-3.5 text-left font-medium text-slate-700 transition-colors hover:bg-blue-50 active:bg-blue-100 touch-target"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400"></span>
                            <span className="truncate">{comment}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-4 text-center">
                      <p className="mb-1 text-sm text-slate-400">Nueva incidencia</p>
                      <p className="break-words text-sm font-bold text-blue-600">"{commentInput}"</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {dynamicFieldError && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {dynamicFieldError}
          </div>
        )}

        <div className="pt-2 pb-6 flex flex-col sm:flex-row gap-3">
          {editingRecord && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-4 px-6 rounded-xl transition-all flex items-center justify-center gap-3 touch-target"
            >
              CANCELAR
            </button>
          )}
          
          <button
            type="submit"
            disabled={!isMachineSchemaReady}
            className={`flex-1 ${editingRecord ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'} text-white font-bold py-4 px-6 rounded-xl shadow-lg transition-all flex items-center justify-center gap-3 active:scale-[0.98] touch-target text-lg`}
          >
            <Save className="w-6 h-6" />
            {editingRecord ? 'ACTUALIZAR' : 'GUARDAR'}
          </button>
        </div>
      </form>

      {/* --- SUCCESS MODAL --- */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in text-center p-8 transform scale-100">
            <div className={`w-20 h-20 ${wasOfflineSave ? 'bg-amber-100' : 'bg-green-100'} rounded-full flex items-center justify-center mx-auto mb-6 ${wasOfflineSave ? 'text-amber-500' : 'text-green-500'} animate-bounce-short shadow-sm`}>
              {wasOfflineSave ? <WifiOff className="w-10 h-10" /> : <CheckCircle className="w-10 h-10" />}
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              {wasOfflineSave ? '¡Registro Guardado Localmente!' : '¡Registro Guardado!'}
            </h2>
            <p className="text-slate-500 mb-8">
              {wasOfflineSave
                ? 'Sin conexión a Internet. El registro se sincronizará automáticamente con la nube cuando se restablezca la conexión.'
                : 'Los datos se han sincronizado correctamente con la nube y el historial.'
              }
            </p>
            
            <button 
              onClick={closeSuccessModal}
              className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
            >
              Continuar
            </button>
            <div className={`mt-4 flex items-center justify-center gap-2 text-xs font-medium ${wasOfflineSave ? 'text-amber-600' : 'text-green-600'}`}>
              {wasOfflineSave
                ? <><WifiOff className="w-3 h-3" /> Pendiente de sincronización</>
                : <><Cloud className="w-3 h-3" /> Sincronizado con la nube</>
              }
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ShiftForm;