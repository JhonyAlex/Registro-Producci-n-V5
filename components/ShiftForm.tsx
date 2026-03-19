import React, { useState, useEffect, useRef } from 'react';
import { Plus, Save, Calendar, CheckCircle, X, ChevronDown, Trash2, RotateCcw, Settings, Edit2, Users, Cloud, WifiOff } from 'lucide-react';
import { MachineFieldDefinition, MachineType, ShiftType, ProductionRecord } from '../types';
import { MACHINES, SHIFTS } from '../constants';
import { 
  saveRecord, 
  deleteCustomComment, 
  renameCustomComment,
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

const STORAGE_KEY = 'pigmea_form_defaults_v1';

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

  // Custom Comment Field State
  const [commentInput, setCommentInput] = useState('');
  const [availableComments, setAvailableComments] = useState<string[]>([]);
  const [filteredComments, setFilteredComments] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Management Modal State (Generic for Comments and Operators)
  type ModalMode = 'comments';
  const [showManageModal, setShowManageModal] = useState(false);
  const [manageMode, setManageMode] = useState<ModalMode>('comments');
  const [editingItemOldName, setEditingItemOldName] = useState<string | null>(null);
  const [tempItemName, setTempItemName] = useState('');

  // Success Modal State
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [wasOfflineSave, setWasOfflineSave] = useState(false);
  const [machineFields, setMachineFields] = useState<MachineFieldDefinition[]>([]);
  const [machineSchemaVersion, setMachineSchemaVersion] = useState<number>(1);
  const [dynamicFieldValues, setDynamicFieldValues] = useState<Record<string, unknown>>({});
  const [dynamicFieldError, setDynamicFieldError] = useState('');
  const [isMachineSchemaReady, setIsMachineSchemaReady] = useState(false);

  // 1. Load Defaults from LocalStorage on Mount (Only if not editing)
  useEffect(() => {
    if (!editingRecord) {
      const savedDefaults = localStorage.getItem(STORAGE_KEY);
      if (savedDefaults) {
        try {
          const parsed = JSON.parse(savedDefaults);
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
  }, []); // Run once on mount

  useEffect(() => {
    if (!formData.bossUserId && availableBossOptions.length > 0) {
      setFormData((prev) => ({ ...prev, bossUserId: availableBossOptions[0].id }));
    }
  }, [availableBossOptions, formData.bossUserId]);

  // 2. Save Defaults to LocalStorage whenever context fields change (Only if not editing)
  useEffect(() => {
    if (!editingRecord) {
      const defaultsToSave = {
        date: formData.date,
        shift: formData.shift,
        bossUserId: formData.bossUserId,
        machine: formData.machine,
        operator: operatorInput,
        operatorUserId
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultsToSave));
    }
  }, [formData.date, formData.shift, formData.bossUserId, formData.machine, operatorInput, operatorUserId, editingRecord]);

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
      setCommentInput('');
      setOperatorUserId(null);
      setDynamicFieldValues({});
    }
  }, [editingRecord]);

  // Subscribe to real-time updates for Comments and Operators
  useEffect(() => {
    const unsubscribe = subscribeToSettings((comments, _operators, _bosses, operatorOptions, bossOptions) => {
      setAvailableComments(comments);
      setAvailableOperatorOptions(operatorOptions);
      setAvailableBossOptions(bossOptions);

      if (!editingRecord && !formData.bossUserId && bossOptions.length > 0) {
        setFormData((prev) => ({ ...prev, bossUserId: bossOptions[0].id }));
      }

      if (!editingRecord) {
        if (!operatorInput && !operatorUserId && operatorOptions.length > 0) {
          setOperatorInput(operatorOptions[0].name);
          setOperatorUserId(operatorOptions[0].id);
        } else if (operatorInput && !operatorUserId) {
          const normalizedInput = operatorInput.trim().toLowerCase();
          const matchedOperator = operatorOptions.find((option) => option.name.trim().toLowerCase() === normalizedInput);
          if (matchedOperator) {
            setOperatorInput(matchedOperator.name);
            setOperatorUserId(matchedOperator.id);
          }
        }
      }

      if (editingRecord && editingRecord.boss && !formData.bossUserId) {
        const matchedBoss = bossOptions.find((option) => option.name === editingRecord.boss);
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
  }, [editingRecord, formData.bossUserId, operatorInput, operatorUserId]);

  useEffect(() => {
    setIsMachineSchemaReady(false);
    const unsubscribe = subscribeToMachineFieldSchema(
      formData.machine,
      (schema) => {
        const enabledFields = (schema.fields || []).filter((field) => field.enabled !== false);
        setMachineFields(enabledFields);
        setMachineSchemaVersion(Number(schema.version || 1));
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
    if (!operatorInput) {
      setFilteredOperators(availableOperatorOptions);
    } else {
      const lowerInput = operatorInput.toLowerCase();
      setFilteredOperators(availableOperatorOptions.filter(o => 
        o.name.toLowerCase().includes(lowerInput)
      ));
    }
  }, [operatorInput, availableOperatorOptions]);

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
      if (operatorDropdownRef.current && !operatorDropdownRef.current.contains(event.target as Node)) {
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
    setOperatorInput('');
    setOperatorUserId(null);
    setFilteredOperators(availableOperatorOptions);
    setShowOperatorSuggestions(true);
  };

  const selectOperator = (op: UserOption) => {
    setOperatorInput(op.name);
    setOperatorUserId(op.id);
    setShowOperatorSuggestions(false);
  };

  // --- Management Handlers (Generic) ---

  const openManageModal = (mode: ModalMode) => {
    setManageMode(mode);
    setEditingItemOldName(null);
    setTempItemName('');
    setShowManageModal(true);
  };

  const handleDeleteItem = async (item: string) => {
    if (confirm(`¿Borrar "${item}" de la lista de incidencias?\n\nNota: Los registros históricos NO se borrarán.`)) {
      await deleteCustomComment(item);
    }
  };

  const startEditingItem = (item: string) => {
    setEditingItemOldName(item);
    setTempItemName(item);
  };

  const saveEditedItem = async () => {
    if (!editingItemOldName || !tempItemName) return;
    
    if (tempItemName !== editingItemOldName) {
      if (confirm(`¿Renombrar "${editingItemOldName}" a "${tempItemName}"?\n\nEsto actualizará TODOS los registros históricos.`)) {
        await renameCustomComment(editingItemOldName, tempItemName);
        if (commentInput === editingItemOldName) setCommentInput(tempItemName);
      }
    }
    setEditingItemOldName(null);
    setTempItemName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isMachineSchemaReady) {
      setDynamicFieldError('Espera un momento: se estan sincronizando los campos de la maquina.');
      return;
    }

    const selectedBoss = availableBossOptions.find((boss) => boss.id === formData.bossUserId);
    if (!selectedBoss) {
      alert('Selecciona un jefe válido desde la lista de usuarios activos.');
      return;
    }

    const normalizedOperatorInput = operatorInput.trim();
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
      changesComment: commentInput,
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
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Users className="w-4 h-4 text-slate-400" /> Operario
                </label>
              </div>
              <div className="relative w-full">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Nombre del operario..."
                    value={operatorInput}
                    onChange={e => {
                      setOperatorInput(e.target.value);
                      setOperatorUserId(null);
                      setShowOperatorSuggestions(true);
                    }}
                    onFocus={handleOperatorFocus}
                    className="w-full pl-4 pr-10 py-3 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                    autoComplete="off"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
                    {operatorInput && (
                      <button type="button" onClick={clearOperator} className="p-1 text-slate-400 hover:text-red-500 transition-colors mr-1">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    <div className={`pointer-events-none text-slate-400 p-1 transition-transform duration-200 ${showOperatorSuggestions ? 'rotate-180' : ''}`}>
                        <ChevronDown className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                {showOperatorSuggestions && (
                  <div className="absolute z-50 w-full bottom-full mb-2 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto animate-fade-in origin-bottom">
                    {filteredOperators.length > 0 ? (
                      <div className="divide-y divide-slate-50">
                        {filteredOperators.map((op, index) => (
                          <div
                            key={`${op.id}-${index}`}
                            onClick={() => selectOperator(op)}
                            className="w-full text-left px-4 py-3.5 hover:bg-blue-50 active:bg-blue-100 text-slate-700 font-medium transition-colors flex items-center justify-between group touch-target cursor-pointer"
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0"></span>
                              <span className="truncate">{op.name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="px-4 py-4 text-center">
                        <p className="text-slate-500 text-sm font-medium">No hay coincidencias en usuarios activos.</p>
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

        {machineFields.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {machineFields.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  {field.label} {field.required ? <span className="text-red-500">*</span> : null}
                </label>

                {field.type === 'number' && (
                  <input
                    type="number"
                    value={(dynamicFieldValues[field.key] as number | string | undefined) ?? ''}
                    min={field.rules?.min}
                    max={field.rules?.max}
                    onWheel={preventNumberScrollChange}
                    onChange={(e) => updateDynamicFieldValue(field.key, e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-4 py-3 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                  />
                )}

                {field.type === 'short_text' && (
                  <input
                    type="text"
                    value={(dynamicFieldValues[field.key] as string | undefined) ?? ''}
                    maxLength={field.rules?.maxLength}
                    onChange={(e) => updateDynamicFieldValue(field.key, e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                  />
                )}

                {field.type === 'select' && (
                  <select
                    value={(dynamicFieldValues[field.key] as string | undefined) ?? ''}
                    onChange={(e) => updateDynamicFieldValue(field.key, e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none font-medium"
                  >
                    <option value="">Selecciona una opción</option>
                    {(field.options || []).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                )}

                {field.type === 'multi_select' && (
                  <div className="space-y-2 px-3 py-3 bg-white border border-slate-300 rounded-lg">
                    {(field.options || []).map((option) => {
                      const selected = Array.isArray(dynamicFieldValues[field.key])
                        ? (dynamicFieldValues[field.key] as string[])
                        : [];
                      const isChecked = selected.includes(option);
                      return (
                        <label key={option} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
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
                          {option}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!isMachineSchemaReady && (
          <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            Sincronizando campos de la maquina. Espera unos segundos antes de guardar.
          </div>
        )}

        {dynamicFieldError && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {dynamicFieldError}
          </div>
        )}

        {/* Production Data */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Comment Input */}
            <div className="md:col-span-2 relative" ref={dropdownRef}>
              <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-semibold text-slate-700">Comentario / Incidencia</label>
                  <button 
                  type="button" 
                  onClick={() => openManageModal('comments')}
                  className="text-xs text-blue-600 font-bold flex items-center gap-1 hover:underline bg-blue-50 px-2 py-1 rounded"
                  >
                    <Settings className="w-3 h-3" /> Config
                  </button>
              </div>
              
              <div className="relative w-full">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Escribir..."
                    value={commentInput}
                    onChange={e => {
                      setCommentInput(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={handleInputFocus}
                    className="w-full pl-4 pr-10 py-3 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-lg"
                    autoComplete="off"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
                    {commentInput && (
                      <button type="button" onClick={clearComment} className="p-1 text-slate-400 hover:text-red-500 transition-colors mr-1">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    <div className={`pointer-events-none text-slate-400 p-1 transition-transform duration-200 ${showSuggestions ? 'rotate-180' : ''}`}>
                        <ChevronDown className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                {showSuggestions && (
                  <div className="absolute z-50 w-full bottom-full mb-2 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto animate-fade-in origin-bottom">
                    {filteredComments.length > 0 ? (
                      <div className="divide-y divide-slate-50">
                        {filteredComments.map((comment, index) => (
                          <div
                            key={index}
                            onClick={() => selectComment(comment)}
                            className="w-full text-left px-4 py-3.5 hover:bg-blue-50 active:bg-blue-100 text-slate-700 font-medium transition-colors flex items-center justify-between group touch-target cursor-pointer"
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"></span>
                              <span className="truncate">{comment}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="px-4 py-4 text-center">
                          <p className="text-slate-400 text-sm mb-1">Nueva incidencia</p>
                          <p className="text-blue-600 font-bold text-sm break-words">"{commentInput}"</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
        </div>

        <div className="pt-2 pb-6 flex gap-3">
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

      {/* --- MANAGE MODAL (Generic) --- */}
      {showManageModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
            <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
               <h3 className="font-bold text-slate-800 flex items-center gap-2">
                 <Settings className="w-5 h-5 text-slate-500" />
                 Gestionar Incidencias
               </h3>
               <button onClick={() => setShowManageModal(false)} className="p-2 hover:bg-slate-200 rounded-full text-slate-500">
                 <X className="w-5 h-5" />
               </button>
            </div>
            
            <div className="p-4 bg-blue-50 border-b border-blue-100 text-xs text-blue-800">
              <span className="font-bold block mb-1">Modo Edición Global:</span>
              Al renombrar, se actualizarán todos los registros históricos. Los cambios son permanentes en la nube.
            </div>

            <div className="overflow-y-auto flex-1 p-2 space-y-1">
              {availableComments.map((item, index) => {
                 const isEditing = editingItemOldName === item;
                 
                 return (
                   <div key={index} className={`p-3 rounded-lg border flex items-center justify-between gap-3 ${isEditing ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-100' : 'bg-white border-slate-100 hover:border-slate-300'}`}>
                     
                     {isEditing ? (
                       <div className="flex-1 flex gap-2">
                         <input 
                           type="text" 
                           value={tempItemName}
                           autoFocus
                           onChange={(e) => setTempItemName(e.target.value)}
                           className="flex-1 px-2 py-1 border rounded text-sm outline-none border-blue-300"
                         />
                         <button onClick={saveEditedItem} className="p-1.5 bg-green-500 text-white rounded hover:bg-green-600">
                           <Save className="w-4 h-4" />
                         </button>
                         <button onClick={() => setEditingItemOldName(null)} className="p-1.5 bg-slate-300 text-slate-600 rounded hover:bg-slate-400">
                           <X className="w-4 h-4" />
                         </button>
                       </div>
                     ) : (
                       <>
                         <span className="text-sm font-medium text-slate-700 break-words flex-1">{item}</span>
                         <div className="flex items-center gap-1 shrink-0">
                           <button 
                             onClick={() => startEditingItem(item)}
                             className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                             title="Renombrar y unificar"
                           >
                             <Edit2 className="w-4 h-4" />
                           </button>
                           <button 
                             onClick={() => handleDeleteItem(item)}
                             className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                             title="Borrar de la lista"
                           >
                             <Trash2 className="w-4 h-4" />
                           </button>
                         </div>
                       </>
                     )}
                   </div>
                 );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ShiftForm;