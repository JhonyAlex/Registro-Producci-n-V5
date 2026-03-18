import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, RefreshCw, History, AlertCircle } from 'lucide-react';
import { MACHINES } from '../constants';
import {
  getMachineFieldSchema,
  getMachineFieldSchemaHistory,
  saveMachineFieldSchema,
  subscribeToMachineFieldSchema,
} from '../services/storageService';
import { DynamicFieldType, MachineFieldDefinition, MachineFieldSchemaHistoryItem, MachineType } from '../types';

type EditableField = {
  id: string;
  key: string;
  label: string;
  type: DynamicFieldType;
  required: boolean;
  enabled: boolean;
  order: number;
  options: string[];
  defaultValueText: string;
  min: string;
  max: string;
  maxLength: string;
};

const FIELD_TYPES: DynamicFieldType[] = ['number', 'short_text', 'select', 'multi_select'];

const FIELD_TYPE_LABELS: Record<DynamicFieldType, string> = {
  number: 'Numero',
  short_text: 'Texto corto',
  select: 'Seleccion unica',
  multi_select: 'Seleccion multiple',
};

const makeEmptyField = (order: number): EditableField => ({
  id: crypto.randomUUID(),
  key: '',
  label: '',
  type: 'short_text',
  required: false,
  enabled: true,
  order,
  options: [],
  defaultValueText: '',
  min: '',
  max: '',
  maxLength: '',
});

const toEditableField = (field: MachineFieldDefinition, index: number): EditableField => {
  let defaultValueText = '';
  if (Array.isArray(field.defaultValue)) {
    defaultValueText = field.defaultValue.join(', ');
  } else if (field.defaultValue !== undefined && field.defaultValue !== null) {
    defaultValueText = String(field.defaultValue);
  }

  return {
    id: `${field.key}-${index}`,
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required === true,
    enabled: field.enabled !== false,
    order: Number.isFinite(field.order) ? field.order : index,
    options: Array.isArray(field.options) ? field.options : [],
    defaultValueText,
    min: field.rules?.min !== undefined ? String(field.rules.min) : '',
    max: field.rules?.max !== undefined ? String(field.rules.max) : '',
    maxLength: field.rules?.maxLength !== undefined ? String(field.rules.maxLength) : '',
  };
};

const toMachineFieldDefinition = (field: EditableField, index: number): MachineFieldDefinition => {
  const options = field.options.map((item) => item.trim()).filter(Boolean);

  const rules: MachineFieldDefinition['rules'] = {};
  if (field.min.trim().length > 0) rules.min = Number(field.min);
  if (field.max.trim().length > 0) rules.max = Number(field.max);
  if (field.maxLength.trim().length > 0) rules.maxLength = Number(field.maxLength);

  let defaultValue: MachineFieldDefinition['defaultValue'];
  if (field.defaultValueText.trim().length > 0) {
    if (field.type === 'number') {
      defaultValue = Number(field.defaultValueText);
    } else if (field.type === 'multi_select') {
      defaultValue = field.defaultValueText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    } else {
      defaultValue = field.defaultValueText.trim();
    }
  }

  return {
    key: field.key.trim(),
    label: field.label.trim(),
    type: field.type,
    required: field.required,
    enabled: field.enabled,
    order: index,
    options,
    defaultValue,
    rules,
  };
};

const MachineFieldManager: React.FC = () => {
  const [selectedMachine, setSelectedMachine] = useState<MachineType>(MACHINES[0] as MachineType);
  const [targetMachines, setTargetMachines] = useState<MachineType[]>([]);
  const [schemaVersion, setSchemaVersion] = useState(1);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [history, setHistory] = useState<MachineFieldSchemaHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const sortedFields = useMemo(() => {
    return [...fields].sort((a, b) => a.order - b.order);
  }, [fields]);

  const availableTargetMachines = useMemo(
    () => MACHINES.filter((machine) => machine !== selectedMachine) as MachineType[],
    [selectedMachine]
  );

  const loadHistory = async (machine: MachineType) => {
    try {
      const nextHistory = await getMachineFieldSchemaHistory(machine);
      setHistory(nextHistory);
    } catch (err: any) {
      setHistory([]);
      setError(err?.message || 'No se pudo cargar historial del esquema.');
    }
  };

  const loadSchema = async (machine: MachineType) => {
    setLoading(true);
    setError('');
    try {
      const schema = await getMachineFieldSchema(machine);
      setSchemaVersion(Number(schema.version || 1));
      setUpdatedAt(schema.updatedAt || null);
      setFields((schema.fields || []).map(toEditableField));
      await loadHistory(machine);
    } catch (err: any) {
      setError(err?.message || 'No se pudo cargar la configuración de campos.');
      setFields([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSchema(selectedMachine);
    const unsubscribe = subscribeToMachineFieldSchema(
      selectedMachine,
      (schema) => {
        setSchemaVersion(Number(schema.version || 1));
        setUpdatedAt(schema.updatedAt || null);
        setFields((schema.fields || []).map(toEditableField));
        setSuccessMessage('El esquema se actualizó en tiempo real.');
        setTimeout(() => setSuccessMessage(''), 2500);
        void loadHistory(selectedMachine);
      },
      (message) => setError(message)
    );

    return () => unsubscribe();
  }, [selectedMachine]);

  useEffect(() => {
    setTargetMachines((prev) => prev.filter((machine) => machine !== selectedMachine));
  }, [selectedMachine]);

  const updateField = (id: string, patch: Partial<EditableField>) => {
    setFields((prev) => prev.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  };

  const updateFieldType = (id: string, type: DynamicFieldType) => {
    setFields((prev) =>
      prev.map((field) => {
        if (field.id !== id) return field;

        const next: EditableField = { ...field, type };

        if (type === 'number') {
          next.maxLength = '';
          next.defaultValueText = field.defaultValueText.trim();
        }

        if (type === 'short_text') {
          next.min = '';
          next.max = '';
          next.options = [];
        }

        if (type === 'select') {
          next.min = '';
          next.max = '';
          next.maxLength = '';
          if (next.options.length === 0) {
            next.options = ['', ''];
          }
        }

        if (type === 'multi_select') {
          next.min = '';
          next.max = '';
          next.maxLength = '';
          if (next.options.length === 0) {
            next.options = ['', ''];
          }
        }

        return next;
      })
    );
  };

  const addOption = (id: string) => {
    setFields((prev) => prev.map((field) => (field.id === id ? { ...field, options: [...field.options, ''] } : field)));
  };

  const updateOption = (id: string, optionIndex: number, value: string) => {
    setFields((prev) =>
      prev.map((field) => {
        if (field.id !== id) return field;
        const nextOptions = [...field.options];
        nextOptions[optionIndex] = value;
        return { ...field, options: nextOptions };
      })
    );
  };

  const removeOption = (id: string, optionIndex: number) => {
    setFields((prev) =>
      prev.map((field) => {
        if (field.id !== id) return field;
        const nextOptions = field.options.filter((_, idx) => idx !== optionIndex);
        return { ...field, options: nextOptions };
      })
    );
  };

  const renderOptionsEditor = (field: EditableField) => (
    <div className="space-y-2 md:col-span-2">
      <p className="text-xs font-semibold text-slate-600">Opciones</p>
      {field.options.length === 0 && (
        <p className="text-xs text-slate-500">Agrega al menos una opcion.</p>
      )}
      {field.options.map((option, optionIndex) => (
        <div key={`${field.id}-option-${optionIndex}`} className="flex items-center gap-2">
          <input
            placeholder={`Opcion ${optionIndex + 1}`}
            value={option}
            onChange={(e) => updateOption(field.id, optionIndex, e.target.value)}
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg bg-white"
          />
          <button
            type="button"
            onClick={() => removeOption(field.id, optionIndex)}
            className="px-2 py-2 text-xs font-semibold rounded bg-red-50 border border-red-200 text-red-600"
          >
            Quitar
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => addOption(field.id)}
        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
      >
        <Plus className="w-3 h-3" /> Agregar opcion
      </button>
    </div>
  );

  const renderFieldTypeSettings = (field: EditableField) => {
    const cleanOptions = field.options.map((item) => item.trim()).filter(Boolean);

    if (field.type === 'number') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            placeholder="Valor por defecto"
            value={field.defaultValueText}
            onChange={(e) => updateField(field.id, { defaultValueText: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
          />
          <input
            placeholder="Minimo"
            value={field.min}
            onChange={(e) => updateField(field.id, { min: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
          />
          <input
            placeholder="Maximo"
            value={field.max}
            onChange={(e) => updateField(field.id, { max: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
          />
        </div>
      );
    }

    if (field.type === 'short_text') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            placeholder="Texto por defecto"
            value={field.defaultValueText}
            onChange={(e) => updateField(field.id, { defaultValueText: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg bg-white md:col-span-2"
          />
          <input
            placeholder="Longitud maxima"
            value={field.maxLength}
            onChange={(e) => updateField(field.id, { maxLength: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
          />
        </div>
      );
    }

    if (field.type === 'select') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start">
          {renderOptionsEditor(field)}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600">Valor por defecto</p>
            <select
              value={field.defaultValueText}
              onChange={(e) => updateField(field.id, { defaultValueText: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
            >
              <option value="">Sin valor por defecto</option>
              {cleanOptions.map((option) => (
                <option key={`${field.id}-default-${option}`} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start">
        {renderOptionsEditor(field)}
        <div className="space-y-2 md:col-span-2">
          <p className="text-xs font-semibold text-slate-600">Valores por defecto</p>
          {cleanOptions.length === 0 ? (
            <p className="text-xs text-slate-500">Primero agrega opciones para seleccionar valores por defecto.</p>
          ) : (
            <div className="space-y-2">
              {cleanOptions.map((option) => {
                const selectedDefaults = field.defaultValueText
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean);
                const checked = selectedDefaults.includes(option);
                return (
                  <label key={`${field.id}-multi-default-${option}`} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const nextDefaults = e.target.checked
                          ? [...selectedDefaults, option]
                          : selectedDefaults.filter((item) => item !== option);
                        updateField(field.id, { defaultValueText: nextDefaults.join(', ') });
                      }}
                    />
                    {option}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((field) => field.id !== id).map((field, index) => ({ ...field, order: index })));
  };

  const moveField = (id: string, direction: 'up' | 'down') => {
    setFields((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const currentIndex = sorted.findIndex((field) => field.id === id);
      if (currentIndex === -1) return prev;

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= sorted.length) return prev;

      const current = sorted[currentIndex];
      sorted[currentIndex] = sorted[targetIndex];
      sorted[targetIndex] = current;

      return sorted.map((field, index) => ({ ...field, order: index }));
    });
  };

  const addField = () => {
    setFields((prev) => [...prev, makeEmptyField(prev.length)]);
  };

  const toggleTargetMachine = (machine: MachineType) => {
    setTargetMachines((prev) =>
      prev.includes(machine)
        ? prev.filter((current) => current !== machine)
        : [...prev, machine]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccessMessage('');
    try {
      const payload = sortedFields.map(toMachineFieldDefinition);
      const result = await saveMachineFieldSchema(selectedMachine, payload, schemaVersion);
      setSchemaVersion(Number(result.version || schemaVersion + 1));
      setUpdatedAt(result.updatedAt || null);
      setFields((result.fields || []).map(toEditableField));
      setSuccessMessage(`Esquema publicado en versión ${result.version}.`);
      await loadHistory(selectedMachine);
    } catch (err: any) {
      if (err?.message?.includes('SCHEMA_WRITE_CONFLICT')) {
        setError('Otro administrador publicó cambios antes que tú. Recarga para continuar.');
      } else {
        setError(err?.message || 'No se pudo guardar el esquema.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleApplyToMachines = async () => {
    if (targetMachines.length === 0) {
      setError('Selecciona al menos una máquina de destino.');
      return;
    }

    setCopying(true);
    setError('');
    setSuccessMessage('');

    const payload = sortedFields.map(toMachineFieldDefinition);
    let copied = 0;
    const failed: string[] = [];

    try {
      for (const targetMachine of targetMachines) {
        try {
          const targetSchema = await getMachineFieldSchema(targetMachine);
          const expectedVersion = Number(targetSchema.version || 1);
          await saveMachineFieldSchema(targetMachine, payload, expectedVersion);
          copied += 1;
        } catch {
          failed.push(targetMachine);
        }
      }

      if (copied > 0) {
        setSuccessMessage(`Esquema aplicado en ${copied} máquina${copied > 1 ? 's' : ''}.`);
      }
      if (failed.length > 0) {
        setError(`No se pudo aplicar en: ${failed.join(', ')}.`);
      }
      setTargetMachines([]);
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 bg-emerald-600 text-white flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Campos Dinámicos por Máquina</h2>
          <p className="text-emerald-50 text-sm">Configura campos numéricos, texto corto, selección y multiselección.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadSchema(selectedMachine)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-sm font-semibold"
        >
          <RefreshCw className="w-4 h-4" /> Recargar
        </button>
      </div>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Máquina</label>
            <select
              value={selectedMachine}
              onChange={(e) => setSelectedMachine(e.target.value as MachineType)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              {MACHINES.map((machine) => (
                <option key={machine} value={machine}>
                  {machine}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide font-bold text-slate-400">Versión vigente</p>
            <p className="text-2xl font-bold text-slate-800">{schemaVersion}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide font-bold text-slate-400">Última actualización</p>
            <p className="text-sm font-semibold text-slate-700">{updatedAt ? new Date(updatedAt).toLocaleString('es-ES') : 'Sin publicar'}</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-4 bg-slate-50">
          <p className="text-sm font-bold text-slate-700 mb-2">Reutilizar esquema en otras máquinas</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            {availableTargetMachines.map((machine) => {
              const checked = targetMachines.includes(machine);
              return (
                <label
                  key={machine}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer ${
                    checked
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTargetMachine(machine)}
                  />
                  {machine}
                </label>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleApplyToMachines}
            disabled={copying || loading || sortedFields.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {copying ? 'Aplicando...' : 'Aplicar esquema a seleccionadas'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm">
            {successMessage}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Definición de Campos</h3>
            <button
              type="button"
              onClick={addField}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
            >
              <Plus className="w-4 h-4" /> Agregar campo
            </button>
          </div>

          {loading ? (
            <div className="p-6 text-slate-500 text-sm bg-slate-50 rounded-lg border border-slate-200">Cargando configuración...</div>
          ) : sortedFields.length === 0 ? (
            <div className="p-6 text-slate-500 text-sm bg-slate-50 rounded-lg border border-slate-200">
              Esta máquina no tiene campos dinámicos aún.
            </div>
          ) : (
            sortedFields.map((field, index) => (
              <div key={field.id} className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-700">Campo {index + 1}</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => moveField(field.id, 'up')} className="px-2 py-1 text-xs font-semibold rounded bg-white border border-slate-200">Subir</button>
                    <button type="button" onClick={() => moveField(field.id, 'down')} className="px-2 py-1 text-xs font-semibold rounded bg-white border border-slate-200">Bajar</button>
                    <button type="button" onClick={() => removeField(field.id)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-red-50 border border-red-200 text-red-600">
                      <Trash2 className="w-3 h-3" /> Quitar
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    placeholder="Clave técnica (ej: temperatura)"
                    value={field.key}
                    onChange={(e) => updateField(field.id, { key: e.target.value })}
                    className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  />
                  <input
                    placeholder="Etiqueta visible"
                    value={field.label}
                    onChange={(e) => updateField(field.id, { label: e.target.value })}
                    className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  />
                  <select
                    value={field.type}
                    onChange={(e) => updateFieldType(field.id, e.target.value as DynamicFieldType)}
                    className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {FIELD_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-4 px-2">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(field.id, { required: e.target.checked })}
                      />
                      Obligatorio
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={field.enabled}
                        onChange={(e) => updateField(field.id, { enabled: e.target.checked })}
                      />
                      Activo
                    </label>
                  </div>
                </div>

                {renderFieldTypeSettings(field)}
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60"
          >
            <Save className="w-4 h-4" /> {saving ? 'Guardando...' : 'Publicar cambios'}
          </button>
        </div>

        <div className="pt-4 border-t border-slate-200">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
            <History className="w-4 h-4" /> Historial de esquema
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {history.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">Sin cambios registrados todavía.</p>
            ) : (
              history.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 px-4 py-3 bg-white">
                  <p className="text-sm font-semibold text-slate-800">
                    Versión {item.details?.previousVersion ?? '?'} → {item.details?.nextVersion ?? '?'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(item.createdAt).toLocaleString('es-ES')} · {item.userName || 'Usuario desconocido'}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MachineFieldManager;
