import React, { useEffect, useState } from 'react';
import { Plus, Save, Edit2, Trash2, RefreshCw, AlertCircle, X } from 'lucide-react';
import { MACHINES } from '../constants';
import {
  createCatalogField,
  deleteCatalogField,
  getFieldCatalog,
  updateCatalogField,
} from '../services/storageService';
import { DynamicFieldType, FieldCatalogEntry, MachineType } from '../types';

const FIELD_TYPES: DynamicFieldType[] = ['number', 'short_text', 'select', 'multi_select'];

const FIELD_TYPE_LABELS: Record<DynamicFieldType, string> = {
  number: 'Numero',
  short_text: 'Texto corto',
  select: 'Seleccion unica',
  multi_select: 'Seleccion multiple',
};

const FIELD_TYPE_BADGE: Record<DynamicFieldType, string> = {
  number: 'bg-blue-100 text-blue-700',
  short_text: 'bg-slate-100 text-slate-700',
  select: 'bg-purple-100 text-purple-700',
  multi_select: 'bg-violet-100 text-violet-700',
};

type EditableEntry = {
  id: string | null;
  key: string;
  label: string;
  type: DynamicFieldType;
  required: boolean;
  options: string[];
  defaultValueText: string;
  min: string;
  max: string;
  maxLength: string;
  assignedMachines: MachineType[];
};

const makeEmpty = (): EditableEntry => ({
  id: null,
  key: '',
  label: '',
  type: 'short_text',
  required: false,
  options: [],
  defaultValueText: '',
  min: '',
  max: '',
  maxLength: '',
  assignedMachines: [],
});

const fromCatalog = (entry: FieldCatalogEntry): EditableEntry => {
  let defaultValueText = '';
  if (Array.isArray(entry.defaultValue)) {
    defaultValueText = entry.defaultValue.join(', ');
  } else if (entry.defaultValue !== undefined && entry.defaultValue !== null) {
    defaultValueText = String(entry.defaultValue);
  }

  return {
    id: entry.id,
    key: entry.key,
    label: entry.label,
    type: entry.type,
    required: entry.required,
    options: entry.options ?? [],
    defaultValueText,
    min: entry.rules?.min !== undefined ? String(entry.rules.min) : '',
    max: entry.rules?.max !== undefined ? String(entry.rules.max) : '',
    maxLength: entry.rules?.maxLength !== undefined ? String(entry.rules.maxLength) : '',
    assignedMachines: [...entry.assignments]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((assignment) => assignment.machine as MachineType),
  };
};

const MachineFieldManager: React.FC = () => {
  const [catalogFields, setCatalogFields] = useState<FieldCatalogEntry[]>([]);
  const [form, setForm] = useState<EditableEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadCatalog = async () => {
    setLoading(true);
    setError('');
    try {
      const entries = await getFieldCatalog();
      setCatalogFields(entries);
    } catch (err: any) {
      setError(err?.message || 'No se pudo cargar el catalogo de campos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, []);

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  const updateForm = (patch: Partial<EditableEntry>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleTypeChange = (type: DynamicFieldType) => {
    if (!form) return;
    const next: EditableEntry = { ...form, type };

    if (type === 'number') {
      next.maxLength = '';
      next.options = [];
    }

    if (type === 'short_text') {
      next.min = '';
      next.max = '';
      next.options = [];
    }

    if (type === 'select' || type === 'multi_select') {
      next.min = '';
      next.max = '';
      next.maxLength = '';
      if (next.options.length === 0) next.options = ['', ''];
    }

    setForm(next);
  };

  const toggleMachine = (machine: MachineType) => {
    if (!form) return;
    updateForm({
      assignedMachines: form.assignedMachines.includes(machine)
        ? form.assignedMachines.filter((item) => item !== machine)
        : [...form.assignedMachines, machine],
    });
  };

  const addOption = () => {
    updateForm({ options: [...(form?.options ?? []), ''] });
  };

  const updateOption = (idx: number, value: string) => {
    if (!form) return;
    const next = [...form.options];
    next[idx] = value;
    updateForm({ options: next });
  };

  const removeOption = (idx: number) => {
    if (!form) return;
    updateForm({ options: form.options.filter((_, index) => index !== idx) });
  };

  const handleSave = async () => {
    if (!form) return;

    const key = form.key.trim();
    const label = form.label.trim();

    if (!key || !label) {
      setError('La clave tecnica y la etiqueta son obligatorias.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const options = form.options.map((option) => option.trim()).filter(Boolean);
      const rules: Record<string, number> = {};

      if (form.min.trim()) rules.min = Number(form.min);
      if (form.max.trim()) rules.max = Number(form.max);
      if (form.maxLength.trim()) rules.maxLength = Number(form.maxLength);

      let defaultValue: string | number | string[] | undefined;
      if (form.defaultValueText.trim()) {
        if (form.type === 'number') {
          defaultValue = Number(form.defaultValueText);
        } else if (form.type === 'multi_select') {
          defaultValue = form.defaultValueText
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        } else {
          defaultValue = form.defaultValueText.trim();
        }
      }

      const payload = {
        key,
        label,
        type: form.type,
        required: form.required,
        options,
        defaultValue,
        rules,
        machines: form.assignedMachines,
      };

      let result: FieldCatalogEntry;

      if (form.id) {
        result = await updateCatalogField(form.id, payload);
        setCatalogFields((prev) => prev.map((field) => (field.id === result.id ? result : field)));
        showSuccess('Campo actualizado correctamente.');
      } else {
        result = await createCatalogField(payload);
        setCatalogFields((prev) => [...prev, result].sort((a, b) => a.label.localeCompare(b.label)));
        showSuccess('Campo creado correctamente.');
      }

      setForm(null);
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar el campo.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: FieldCatalogEntry) => {
    if (!window.confirm(`Eliminar el campo "${entry.label}"? Se quitara de todas las maquinas.`)) return;

    setDeletingId(entry.id);
    setError('');

    try {
      await deleteCatalogField(entry.id);
      setCatalogFields((prev) => prev.filter((field) => field.id !== entry.id));
      showSuccess('Campo eliminado.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo eliminar el campo.');
    } finally {
      setDeletingId(null);
    }
  };

  const renderTypeSettings = () => {
    if (!form) return null;

    const cleanOptions = form.options.map((item) => item.trim()).filter(Boolean);

    const optionsEditor = (
      <div className="space-y-2 md:col-span-2">
        <p className="text-xs font-semibold text-slate-600">Opciones</p>
        {form.options.length === 0 && <p className="text-xs text-slate-400">Agrega al menos una opcion.</p>}

        {form.options.map((option, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              placeholder={`Opcion ${index + 1}`}
              value={option}
              onChange={(e) => updateOption(index, e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            />
            <button
              type="button"
              onClick={() => removeOption(index)}
              className="px-2 py-2 text-xs font-semibold rounded bg-red-50 border border-red-200 text-red-600 hover:bg-red-100"
            >
              X
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addOption}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
        >
          <Plus className="w-3 h-3" /> Agregar opcion
        </button>
      </div>
    );

    if (form.type === 'number') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:col-span-2">
          <input
            placeholder="Minimo"
            value={form.min}
            onChange={(e) => updateForm({ min: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          />
          <input
            placeholder="Maximo"
            value={form.max}
            onChange={(e) => updateForm({ max: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          />
          <input
            placeholder="Valor por defecto"
            value={form.defaultValueText}
            onChange={(e) => updateForm({ defaultValueText: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          />
        </div>
      );
    }

    if (form.type === 'short_text') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:col-span-2">
          <input
            placeholder="Longitud maxima"
            value={form.maxLength}
            onChange={(e) => updateForm({ maxLength: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          />
          <input
            placeholder="Texto por defecto"
            value={form.defaultValueText}
            onChange={(e) => updateForm({ defaultValueText: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white md:col-span-2"
          />
        </div>
      );
    }

    if (form.type === 'select') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:col-span-2">
          {optionsEditor}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-600">Valor por defecto</p>
            <select
              value={form.defaultValueText}
              onChange={(e) => updateForm({ defaultValueText: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="">Sin valor por defecto</option>
              {cleanOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:col-span-2">
        {optionsEditor}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-600">Valores por defecto</p>
          {cleanOptions.length === 0 ? (
            <p className="text-xs text-slate-500">Primero agrega opciones.</p>
          ) : (
            cleanOptions.map((option) => {
              const selected = form.defaultValueText
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
              return (
                <label key={option} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selected, option]
                        : selected.filter((item) => item !== option);
                      updateForm({ defaultValueText: next.join(', ') });
                    }}
                  />
                  {option}
                </label>
              );
            })
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 bg-emerald-600 text-white flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Catalogo de Campos Dinamicos</h2>
          <p className="text-emerald-50 text-sm">Crea un campo una vez y asignalo a una o varias maquinas.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadCatalog()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-sm font-semibold"
          >
            <RefreshCw className="w-4 h-4" /> Recargar
          </button>
          {!form && (
            <button
              type="button"
              onClick={() => {
                setForm(makeEmpty());
                setError('');
              }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-emerald-700 text-sm font-bold hover:bg-emerald-50"
            >
              <Plus className="w-4 h-4" /> Nuevo campo
            </button>
          )}
        </div>
      </div>

      <div className="p-6 space-y-5">
        {form && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">{form.id ? 'Editar campo' : 'Nuevo campo'}</h3>
              <button
                type="button"
                onClick={() => {
                  setForm(null);
                  setError('');
                }}
                className="p-1.5 rounded hover:bg-blue-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Clave tecnica</label>
                <input
                  placeholder="ej: temperatura"
                  value={form.key}
                  onChange={(e) => updateForm({ key: e.target.value })}
                  disabled={Boolean(form.id)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1">Etiqueta visible</label>
                <input
                  placeholder="ej: Temperatura de operacion"
                  value={form.label}
                  onChange={(e) => updateForm({ label: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo</label>
                <select
                  value={form.type}
                  onChange={(e) => handleTypeChange(e.target.value as DynamicFieldType)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>{FIELD_TYPE_LABELS[type]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {renderTypeSettings()}
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.required}
                onChange={(e) => updateForm({ required: e.target.checked })}
              />
              Campo obligatorio
            </label>

            <div>
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">Asignar a maquinas</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {(MACHINES as MachineType[]).map((machine) => {
                  const checked = form.assignedMachines.includes(machine);
                  return (
                    <label
                      key={machine}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer select-none font-medium ${
                        checked
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-emerald-600"
                        checked={checked}
                        onChange={() => toggleMachine(machine)}
                      />
                      {machine}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Guardando...' : form.id ? 'Actualizar campo' : 'Crear campo'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm(null);
                  setError('');
                }}
                className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm">
            {success}
          </div>
        )}

        {loading ? (
          <div className="p-6 text-slate-500 text-sm bg-slate-50 rounded-lg border border-slate-200">
            Cargando catalogo...
          </div>
        ) : catalogFields.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-slate-500 text-sm mb-3">No hay campos definidos todavia.</p>
            <button
              type="button"
              onClick={() => {
                setForm(makeEmpty());
                setError('');
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700"
            >
              <Plus className="w-4 h-4" /> Crear primer campo
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {catalogFields.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300"
              >
                <span className="font-semibold text-slate-800 text-sm">{entry.label}</span>
                <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{entry.key}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${FIELD_TYPE_BADGE[entry.type]}`}>
                  {FIELD_TYPE_LABELS[entry.type]}
                </span>
                {entry.required && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-red-50 text-red-600">Obligatorio</span>
                )}

                <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                  {entry.assignments.length === 0 ? (
                    <span className="text-xs text-slate-400 italic">Sin maquinas asignadas</span>
                  ) : (
                    [...entry.assignments]
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((assignment) => (
                        <span
                          key={`${entry.id}-${assignment.machine}`}
                          className="text-xs font-medium px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
                        >
                          {assignment.machine}
                        </span>
                      ))
                  )}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setForm(fromCatalog(entry));
                      setError('');
                    }}
                    disabled={Boolean(form)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                  >
                    <Edit2 className="w-3 h-3" /> Editar
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDelete(entry)}
                    disabled={deletingId === entry.id}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" /> {deletingId === entry.id ? '...' : 'Eliminar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MachineFieldManager;
