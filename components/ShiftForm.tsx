import React, { useState, useEffect, useRef } from 'react';
import { Plus, Save, Calendar, CheckCircle, X, ChevronDown, MessageSquare, Trash2, RotateCcw, Settings, Edit2, Users, Cloud } from 'lucide-react';
import { MachineType, ShiftType, BossType, ProductionRecord } from '../types';
import { MACHINES, SHIFTS, BOSSES } from '../constants';
import { 
  saveRecord, 
  deleteCustomComment, 
  renameCustomComment,
  deleteCustomOperator,
  renameCustomOperator,
  subscribeToSettings
} from '../services/storageService';

interface ShiftFormProps {
  onRecordSaved: () => void;
  editingRecord?: ProductionRecord | null;
  onCancelEdit?: () => void;
}

const STORAGE_KEY = 'pigmea_form_defaults_v1';

const ShiftForm: React.FC<ShiftFormProps> = ({ onRecordSaved, editingRecord, onCancelEdit }) => {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    shift: ShiftType.MORNING,
    boss: BossType.MARTIN,
    machine: MachineType.WH1,
  });

  // Handle inputs as strings to prevent "0" prefix issues on mobile
  const [metersInput, setMetersInput] = useState('');
  const [changesInput, setChangesInput] = useState('');
  
  // Custom Operator Field State
  const [operatorInput, setOperatorInput] = useState('');
  const [availableOperators, setAvailableOperators] = useState<string[]>([]);
  const [filteredOperators, setFilteredOperators] = useState<string[]>([]);
  const [showOperatorSuggestions, setShowOperatorSuggestions] = useState(false);
  const operatorDropdownRef = useRef<HTMLDivElement>(null);

  // Custom Comment Field State
  const [commentInput, setCommentInput] = useState('');
  const [availableComments, setAvailableComments] = useState<string[]>([]);
  const [filteredComments, setFilteredComments] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Management Modal State (Generic for Comments and Operators)
  type ModalMode = 'comments' | 'operators';
  const [showManageModal, setShowManageModal] = useState(false);
  const [manageMode, setManageMode] = useState<ModalMode>('comments');
  const [editingItemOldName, setEditingItemOldName] = useState<string | null>(null);
  const [tempItemName, setTempItemName] = useState('');

  // Success Modal State
  const [showSuccessModal, setShowSuccessModal] = useState(false);

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
            boss: parsed.boss || prev.boss,
            machine: parsed.machine || prev.machine
          }));
          if (parsed.operator) setOperatorInput(parsed.operator);
        } catch (e) {
          console.error("Error loading saved defaults", e);
        }
      }
    }
  }, []); // Run once on mount

  // 2. Save Defaults to LocalStorage whenever context fields change (Only if not editing)
  useEffect(() => {
    if (!editingRecord) {
      const defaultsToSave = {
        date: formData.date,
        shift: formData.shift,
        boss: formData.boss,
        machine: formData.machine,
        operator: operatorInput
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultsToSave));
    }
  }, [formData.date, formData.shift, formData.boss, formData.machine, operatorInput, editingRecord]);

  // Load editing data when record changes
  useEffect(() => {
    if (editingRecord) {
      setFormData({
        date: editingRecord.date,
        shift: editingRecord.shift,
        boss: editingRecord.boss,
        machine: editingRecord.machine,
      });
      setMetersInput(editingRecord.meters.toString());
      setChangesInput(editingRecord.changesCount.toString());
      setCommentInput(editingRecord.changesComment || '');
      setOperatorInput(editingRecord.operator || '');
      // Scroll to top when editing starts
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setMetersInput('');
      setChangesInput('');
      setCommentInput('');
    }
  }, [editingRecord]);

  // Subscribe to real-time updates for Comments and Operators
  useEffect(() => {
    const unsubscribe = subscribeToSettings((comments, operators) => {
      setAvailableComments(comments);
      setAvailableOperators(operators);
    });
    return () => unsubscribe();
  }, []);

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
      setFilteredOperators(availableOperators);
    } else {
      const lowerInput = operatorInput.toLowerCase();
      setFilteredOperators(availableOperators.filter(o => 
        o.toLowerCase().includes(lowerInput)
      ));
    }
  }, [operatorInput, availableOperators]);

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

  const handleMetersChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, '');
    setMetersInput(rawValue);
  };

  const handleChangesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, '');
    setChangesInput(rawValue);
  };

  const formatMeters = (value: string) => {
    if (!value) return '';
    return parseInt(value).toLocaleString('es-ES');
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
    setFilteredOperators(availableOperators);
  };

  const handleOperatorFocus = () => {
    setShowOperatorSuggestions(true);
  };

  const selectOperator = (op: string) => {
    setOperatorInput(op);
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
    if (manageMode === 'comments') {
      if (confirm(`¿Borrar "${item}" de la lista de incidencias?\n\nNota: Los registros históricos NO se borrarán.`)) {
        await deleteCustomComment(item);
      }
    } else {
      if (confirm(`¿Borrar "${item}" de la lista de operarios?\n\nNota: Los registros históricos NO se borrarán.`)) {
        await deleteCustomOperator(item);
      }
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
        if (manageMode === 'comments') {
          await renameCustomComment(editingItemOldName, tempItemName);
          if (commentInput === editingItemOldName) setCommentInput(tempItemName);
        } else {
          await renameCustomOperator(editingItemOldName, tempItemName);
          if (operatorInput === editingItemOldName) setOperatorInput(tempItemName);
        }
      }
    }
    setEditingItemOldName(null);
    setTempItemName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!metersInput) return;

    const id = editingRecord ? editingRecord.id : crypto.randomUUID();
    const timestamp = editingRecord ? editingRecord.timestamp : Date.now();

    const newRecord: ProductionRecord = {
      id,
      timestamp,
      date: formData.date,
      shift: formData.shift,
      boss: formData.boss,
      machine: formData.machine,
      meters: parseInt(metersInput),
      changesCount: changesInput === '' ? 0 : parseInt(changesInput),
      changesComment: commentInput,
      operator: operatorInput
    };

    // Save Logic
    await saveRecord(newRecord);
    
    // Trigger Success Modal
    setShowSuccessModal(true);

    // Notify Parent
    onRecordSaved();
    
    // Reset Logic
    if (!editingRecord) {
      setMetersInput('');
      setChangesInput('');
      setCommentInput('');
      // Operator, Boss, Shift, Date, Machine stay the same!
    } else {
       setMetersInput('');
       setChangesInput('');
       setCommentInput('');
    }
  };

  const closeSuccessModal = () => {
    setShowSuccessModal(false);
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
                value={formData.boss}
                onChange={e => setFormData({ ...formData, boss: e.target.value as BossType })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none font-medium"
              >
                {BOSSES.map(boss => (
                  <option key={boss} value={boss}>{boss}</option>
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
                <button 
                  type="button" 
                  onClick={() => openManageModal('operators')}
                  className="text-xs text-blue-600 font-bold flex items-center gap-1 hover:underline bg-blue-50 px-2 py-1 rounded"
                >
                  <Settings className="w-3 h-3" /> Config
                </button>
              </div>
              <div className="relative w-full">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Nombre del operario..."
                    value={operatorInput}
                    onChange={e => {
                      setOperatorInput(e.target.value);
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
                            key={index}
                            onClick={() => selectOperator(op)}
                            className="w-full text-left px-4 py-3.5 hover:bg-blue-50 active:bg-blue-100 text-slate-700 font-medium transition-colors flex items-center justify-between group touch-target cursor-pointer"
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0"></span>
                              <span className="truncate">{op}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => selectOperator(operatorInput)}
                        className="w-full px-4 py-4 text-left hover:bg-blue-50 transition-colors flex items-center gap-3 group"
                      >
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                            <Plus className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs font-medium">No encontrado en la lista</p>
                            <p className="text-blue-700 font-bold text-sm break-words">
                              Crear "{operatorInput}"
                            </p>
                          </div>
                      </button>
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

        {/* Production Data */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            
            {/* Meters Input */}
            <div className="md:col-span-1">
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Metros
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  placeholder="0"
                  value={formatMeters(metersInput)}
                  onChange={handleMetersChange}
                  className="w-full px-4 py-3 text-right bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-medium text-lg"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold pointer-events-none">MTS</span>
              </div>
            </div>

            {/* Changes Input */}
            <div className="md:col-span-1">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Cambios</label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={changesInput}
                onChange={handleChangesChange}
                className="w-full px-4 py-3 text-center bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-medium text-lg"
              />
            </div>
            
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
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 text-green-500 animate-bounce-short shadow-sm">
              <CheckCircle className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">¡Registro Guardado!</h2>
            <p className="text-slate-500 mb-8">
              Los datos se han sincronizado correctamente con la nube y el historial.
            </p>
            
            <button 
              onClick={closeSuccessModal}
              className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
            >
              Continuar
            </button>
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-green-600 font-medium">
               <Cloud className="w-3 h-3" /> Sincronizado
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
                 {manageMode === 'comments' ? 'Gestionar Incidencias' : 'Gestionar Operarios'}
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
              {(manageMode === 'comments' ? availableComments : availableOperators).map((item, index) => {
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