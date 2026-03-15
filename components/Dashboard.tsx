import React, { useMemo, useState, useEffect, useRef } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Cell, PieChart, Pie, Legend, AreaChart, Area
} from 'recharts';
import { FileText, Table, Activity, AlertTriangle, Users, CalendarRange, Layers, Info, Loader2, Download, TrendingUp } from 'lucide-react';
import { ProductionRecord } from '../types';
import { exportToExcel, subscribeToSettings } from '../services/storageService';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface DashboardProps {
  records: ProductionRecord[];
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6', '#f43f5e'];

// Internal Tooltip Component
const InfoTooltip: React.FC<{ text: string }> = ({ text }) => (
  <div className="group relative ml-2 inline-flex items-center">
    <Info className="w-4 h-4 text-slate-300 hover:text-blue-500 cursor-help transition-colors" />
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2.5 bg-slate-800 text-white text-[11px] leading-tight rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl border border-slate-700">
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-800"></div>
    </div>
  </div>
);

const Dashboard: React.FC<DashboardProps> = ({ records }) => {
  // Ref for PDF capture
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // State for available comments to canonicalize display names
  const [availableComments, setAvailableComments] = useState<string[]>([]);

  // Subscribe to settings to get the official list of comments
  useEffect(() => {
    const unsubscribe = subscribeToSettings((comments) => {
      setAvailableComments(comments);
    });
    return () => unsubscribe();
  }, []);

  // 1. Calculate Summary Metrics based on FILTERED records
  const summary = useMemo(() => {
    const totalRecords = records.length;
    
    if (totalRecords === 0) {
      return {
        totalMeters: 0,
        avgMeters: 0,
        totalChanges: 0,
        avgChanges: 0,
        efficiency: 0,
        count: 0
      };
    }

    const totalMeters = records.reduce((acc, r) => acc + r.meters, 0);
    const avgMeters = Math.round(totalMeters / totalRecords);

    const totalChanges = records.reduce((acc, r) => acc + r.changesCount, 0);
    const avgChanges = (totalChanges / totalRecords).toFixed(1);

    // Calculate dynamic efficiency based on filtered set
    // Assuming target 5000m per shift as roughly 100%
    const efficiency = Math.min(100, Math.round((avgMeters / 5000) * 100));

    return {
      totalMeters,
      avgMeters,
      totalChanges,
      avgChanges,
      efficiency,
      count: totalRecords
    };
  }, [records]);

  // 2. Machine Performance Data
  const machineData = useMemo(() => {
    const grouped: Record<string, number> = {};
    records.forEach(r => {
      grouped[r.machine] = (grouped[r.machine] || 0) + r.meters;
    });
    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [records]);

  // 3. Operator Performance Data
  const operatorData = useMemo(() => {
    const grouped: Record<string, number> = {};
    records.forEach(r => {
      if (r.operator) {
        grouped[r.operator] = (grouped[r.operator] || 0) + r.meters;
      }
    });
    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10); // Top 10
  }, [records]);

  // 4. Shift Distribution
  const shiftData = useMemo(() => {
    const grouped: Record<string, number> = {};
    records.forEach(r => {
      grouped[r.shift] = (grouped[r.shift] || 0) + r.meters;
    });
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [records]);

  // 5. Boss Performance
  const bossData = useMemo(() => {
    const grouped: Record<string, number> = {};
    records.forEach(r => {
      grouped[r.boss] = (grouped[r.boss] || 0) + r.meters;
    });
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [records]);

  // 6. Incident/Comment Analytics (Normalized and Synchronized)
  const incidentsData = useMemo(() => {
    const groups: Record<string, { count: number, displayName: string }> = {};

    // Map normalized keys to canonical names from the settings
    const canonicalMap: Record<string, string> = {};
    availableComments.forEach(c => {
        const key = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        canonicalMap[key] = c;
    });

    records.forEach(r => {
      if (r.changesComment && r.changesComment.trim().length > 1) {
        const rawComment = r.changesComment.trim();
        const normalizedKey = rawComment
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();

        // Use canonical name if available (exact match from settings), otherwise use the raw comment
        const canonicalName = canonicalMap[normalizedKey];
        
        if (!groups[normalizedKey]) {
          groups[normalizedKey] = { 
            count: 0, 
            displayName: canonicalName || rawComment 
          };
        } else {
            // If we found a canonical name later or it wasn't set correctly, update it
            if (canonicalName) {
                groups[normalizedKey].displayName = canonicalName;
            }
        }
        groups[normalizedKey].count += 1;
      }
    });

    return Object.values(groups)
      .map((item) => ({ name: item.displayName, value: item.count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [records, availableComments]);

  // 7. Time Trend Data (Date vs Meters)
  const trendData = useMemo(() => {
    const grouped: Record<string, number> = {};
    records.forEach(r => {
      // Aggregate by date
      grouped[r.date] = (grouped[r.date] || 0) + r.meters;
    });
    
    return Object.entries(grouped)
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date)); // Sort chronologically
  }, [records]);

  // Determine chart min-width based on data points to allow scrolling
  const chartMinWidth = Math.max(trendData.length * 50, 600); 

  // Handle PDF Generation using html2canvas for faithful visual reproduction
  const handleExportDashboardPDF = async () => {
    if (!dashboardRef.current || isGeneratingPdf) return;
    
    setIsGeneratingPdf(true);
    
    try {
      // Use html2canvas to capture the DOM
      const canvas = await html2canvas(dashboardRef.current, {
        scale: 2, // Improve quality
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff' // Ensure white background
      });

      const imgData = canvas.toDataURL('image/png');
      
      // Calculate orientation based on aspect ratio
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const orientation = imgWidth > imgHeight ? 'l' : 'p';
      
      const pdf = new jsPDF(orientation, 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      // Add Title Header
      pdf.setFontSize(16);
      pdf.setTextColor(40);
      pdf.text("Informe Visual de Dashboard - Pigmea", 10, 15);
      
      pdf.setFontSize(10);
      pdf.setTextColor(100);
      const dateStr = new Date().toLocaleString('es-ES');
      pdf.text(`Generado: ${dateStr} | Registros analizados: ${summary.count}`, 10, 22);

      // Calculate image dimensions to fit page maintaining aspect ratio
      const margin = 10;
      const availableWidth = pdfWidth - (margin * 2);
      const availableHeight = pdfHeight - 30; // Minus header space
      
      const widthRatio = availableWidth / imgWidth;
      const heightRatio = availableHeight / imgHeight;
      const ratio = Math.min(widthRatio, heightRatio);
      
      const finalWidth = imgWidth * ratio;
      const finalHeight = imgHeight * ratio;
      
      // Center horizontally
      const xPos = (pdfWidth - finalWidth) / 2;
      
      pdf.addImage(imgData, 'PNG', xPos, 30, finalWidth, finalHeight);
      pdf.save(`Dashboard_Pigmea_${new Date().toISOString().slice(0,10)}.pdf`);

    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Error generando el PDF visual. Intente desde un navegador de escritorio.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6 pb-24 md:pb-20">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white md:bg-transparent p-4 md:p-0 rounded-xl md:rounded-none shadow-sm md:shadow-none border border-slate-100 md:border-none">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-800">Dashboard</h2>
          <p className="text-xs md:text-sm text-slate-500 flex items-center gap-1 mt-1">
             <CalendarRange className="w-3 h-3" />
             Analizando <span className="font-bold text-slate-700">{summary.count}</span> registros.
          </p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button 
            onClick={() => exportToExcel(records)}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-lg transition-colors text-xs md:text-sm font-bold shadow-sm active:scale-95 transform duration-100"
          >
            <Table className="w-4 h-4" /> Excel
          </button>
          <button 
            onClick={handleExportDashboardPDF}
            disabled={isGeneratingPdf}
            className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-colors text-xs md:text-sm font-bold shadow-sm active:scale-95 transform duration-100
              ${isGeneratingPdf ? 'bg-slate-300 cursor-not-allowed text-slate-500' : 'bg-red-600 hover:bg-red-700 text-white'}
            `}
          >
            {isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} 
            {isGeneratingPdf ? 'Generando...' : 'PDF Visual'}
          </button>
        </div>
      </div>

      {/* Capture Area Ref */}
      <div ref={dashboardRef} className="bg-slate-50 p-2 md:p-4 -m-2 md:-m-4 rounded-xl">
        {/* KPI Cards - Dynamic based on filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-4 md:mb-6">
          
          {/* KPI 1 */}
          <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center">
                 <p className="text-slate-500 text-xs md:text-sm font-bold uppercase tracking-wider">Producción Total</p>
                 {!isGeneratingPdf && <InfoTooltip text="Suma total de metros producidos en todos los registros seleccionados." />}
              </div>
              <div className="p-2 bg-blue-50 rounded-lg">
                <Layers className="w-5 h-5 text-blue-500" />
              </div>
            </div>
            <div className="flex items-baseline gap-1">
              <h3 className="text-2xl md:text-3xl font-bold text-slate-900">{summary.totalMeters.toLocaleString()}</h3>
              <span className="text-sm font-medium text-slate-400">m</span>
            </div>
            <p className="text-xs mt-2 font-medium text-slate-500 bg-slate-50 inline-block px-2 py-1 rounded">
               Promedio: <strong>{summary.avgMeters.toLocaleString()} m</strong> / turno
            </p>
          </div>

          {/* KPI 2 */}
          <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center">
                <p className="text-slate-500 text-xs md:text-sm font-bold uppercase tracking-wider">Eficiencia</p>
                {!isGeneratingPdf && <InfoTooltip text="Cálculo basado en una meta de 5000 metros por turno." />}
              </div>
              <div className="p-2 bg-green-50 rounded-lg">
                <Activity className="w-5 h-5 text-green-500" />
              </div>
            </div>
            <h3 className="text-2xl md:text-3xl font-bold text-slate-900">{summary.efficiency}%</h3>
            <div className="w-full bg-slate-100 rounded-full h-2 mt-3 overflow-hidden">
              <div 
                className={`h-2 rounded-full transition-all duration-1000 ${summary.efficiency > 80 ? 'bg-green-500' : summary.efficiency > 50 ? 'bg-orange-500' : 'bg-red-500'}`}
                style={{ width: `${summary.efficiency}%` }}
              ></div>
            </div>
          </div>

          {/* KPI 3 */}
          <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center">
                <p className="text-slate-500 text-xs md:text-sm font-bold uppercase tracking-wider">Media Cambios</p>
                {!isGeneratingPdf && <InfoTooltip text="Promedio de cambios realizados por turno registrado." />}
              </div>
              <div className="p-2 bg-orange-50 rounded-lg">
                <Activity className="w-5 h-5 text-orange-500" />
              </div>
            </div>
            <h3 className="text-2xl md:text-3xl font-bold text-slate-900">{summary.avgChanges}</h3>
            <p className="text-xs text-slate-400 mt-2 font-medium">Por turno registrado</p>
          </div>
        </div>

        {/* TIME TREND CHART (Full Width) */}
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200 mb-4 md:mb-6">
            <h4 className="text-xs md:text-sm font-bold text-slate-700 mb-6 uppercase flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-slate-400" /> Tendencia de Producción
              {!isGeneratingPdf && <InfoTooltip text="Metros totales producidos por día." />}
            </h4>
            
            {/* Scroll Container */}
            <div className="w-full overflow-x-auto pb-2 scrollbar-hide">
               {/* Inner container with min-width to force scroll if many items */}
               <div style={{ minWidth: isGeneratingPdf ? '100%' : `${chartMinWidth}px`, height: '300px' }}>
                 {trendData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorMeters" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="date" 
                          axisLine={false}
                          tickLine={false}
                          tick={{fill: '#64748b', fontSize: 10}}
                          dy={10}
                        />
                        <YAxis 
                          axisLine={false}
                          tickLine={false}
                          tick={{fill: '#64748b', fontSize: 10}}
                          tickFormatter={(val) => `${val/1000}k`}
                        />
                        <Tooltip 
                          contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                          formatter={(value: number) => [`${value.toLocaleString()} m`, "Metros"]}
                          labelStyle={{color: '#64748b', marginBottom: '0.5rem'}}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="value" 
                          stroke="#3b82f6" 
                          fillOpacity={1} 
                          fill="url(#colorMeters)" 
                          strokeWidth={2}
                          activeDot={{ r: 6 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                 ) : (
                    <div className="h-full flex items-center justify-center text-slate-400 text-sm italic">
                       Sin datos en el periodo seleccionado
                    </div>
                 )}
               </div>
            </div>
            {/* Scroll Hint only if not generating PDF and data is large */}
            {!isGeneratingPdf && trendData.length > 10 && (
                <div className="text-center text-[10px] text-slate-400 mt-2 md:hidden animate-pulse">
                  Desliza para ver más →
                </div>
            )}
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          
          {/* Machine Performance */}
          <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
            <h4 className="text-xs md:text-sm font-bold text-slate-700 mb-6 uppercase flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-400" /> Producción por Máquina
              {!isGeneratingPdf && <InfoTooltip text="Metros producidos por máquina." />}
            </h4>
            <div className="h-64 w-full">
               {machineData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={machineData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fill: '#64748b', fontSize: 10}} 
                        interval={0} 
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fill: '#64748b', fontSize: 10}} 
                        tickFormatter={(val) => `${val/1000}k`} 
                        width={30}
                      />
                      <Tooltip 
                        cursor={{fill: '#f1f5f9'}}
                        contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {machineData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
               ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm">Sin datos</div>
               )}
            </div>
          </div>

          {/* Operator Performance */}
          <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
            <h4 className="text-xs md:text-sm font-bold text-slate-700 mb-6 uppercase flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" /> Top Operarios
              {!isGeneratingPdf && <InfoTooltip text="Los 10 operarios con mayor producción." />}
            </h4>
            {operatorData.length > 0 ? (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={operatorData} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                    <XAxis type="number" hide />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      width={80} 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fill: '#475569', fontSize: 10, fontWeight: 500}} 
                    />
                    <Tooltip cursor={{fill: '#f1f5f9'}} />
                    <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={16}>
                      {operatorData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[(index + 4) % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
               <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2 border-2 border-dashed border-slate-100 rounded-lg">
                <Users className="w-8 h-8 opacity-50" />
                <p className="text-sm">Sin datos de operarios</p>
              </div>
            )}
          </div>

          {/* Boss & Shift Distribution */}
          <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200 lg:col-span-2">
             <h4 className="text-xs md:text-sm font-bold text-slate-700 mb-6 uppercase flex items-center gap-2">
               Distribución de Carga
               {!isGeneratingPdf && <InfoTooltip text="Proporción de metros producidos por Turno y por Jefe." />}
             </h4>
             
             {/* On mobile, use auto height so graphs stack. On MD, use fixed height for side-by-side */}
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-auto md:h-64">
                
                {/* Shift Pie Chart */}
                <div className="w-full h-64 md:h-full relative">
                   <h5 className="absolute top-0 left-0 text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded">POR TURNO</h5>
                   {shiftData.length > 0 ? (
                     <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={shiftData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {shiftData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend verticalAlign="bottom" height={36} iconSize={10} wrapperStyle={{fontSize: '11px'}} />
                        </PieChart>
                     </ResponsiveContainer>
                   ) : <div className="h-full flex items-center justify-center text-slate-300">Sin datos</div>}
                </div>

                {/* Boss Pie Chart */}
                <div className="w-full h-64 md:h-full relative border-t md:border-t-0 border-slate-100 pt-6 md:pt-0">
                   <h5 className="absolute top-6 md:top-0 left-0 text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded">POR JEFE</h5>
                   {bossData.length > 0 ? (
                     <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={bossData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {bossData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[(index + 3) % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend verticalAlign="bottom" height={36} iconSize={10} wrapperStyle={{fontSize: '11px'}} />
                        </PieChart>
                     </ResponsiveContainer>
                   ) : <div className="h-full flex items-center justify-center text-slate-300">Sin datos</div>}
                </div>
             </div>
          </div>

          {/* Incidents Analytics */}
          <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200 lg:col-span-2">
            <div className="flex justify-between items-center mb-6">
               <h4 className="text-xs md:text-sm font-bold text-slate-700 uppercase flex items-center gap-2">
                 Motivos de Cambios
                 {!isGeneratingPdf && <InfoTooltip text="Palabras clave más frecuentes en incidencias." />}
               </h4>
               {incidentsData.length > 0 && <span className="text-[10px] text-orange-600 bg-orange-50 px-2 py-1 rounded-full font-bold">Patrones</span>}
            </div>
            
            {incidentsData.length > 0 ? (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={incidentsData} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                    <XAxis type="number" hide />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      width={100} 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fill: '#475569', fontSize: 10, fontWeight: 500}} 
                    />
                    <Tooltip cursor={{fill: '#f1f5f9'}} />
                    <Bar dataKey="value" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2 border-2 border-dashed border-slate-100 rounded-lg">
                <AlertTriangle className="w-8 h-8 opacity-50" />
                <p className="text-sm">Sin suficientes datos</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;