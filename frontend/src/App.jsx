import React, { useState, useEffect, useRef } from 'react'

const getGovPeriod = (dateStr) => {
    if (!dateStr) return "other";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "other";
    
    // Gustavo Petro: 2022-08-07 onwards
    const petroStart = new Date("2022-08-07");
    // Iván Duque: 2018-08-07 to 2022-08-06
    const duqueStart = new Date("2018-08-07");
    const duqueEnd = new Date("2022-08-06");
    // Juan Manuel Santos II: 2014-08-07 to 2018-08-06
    const santosStart = new Date("2014-08-07");
    const santosEnd = new Date("2018-08-06");
    
    if (date >= petroStart) return "petro";
    if (date >= duqueStart && date <= duqueEnd) return "duque";
    if (date >= santosStart && date <= santosEnd) return "santos2";
    return "other";
};

const detectSplitting = (contracts) => {
    const groups = {};
    contracts.forEach(c => {
        const doc = c.documento_proveedor;
        if (!doc || doc === "No Definido") return;
        if (!groups[doc]) groups[doc] = [];
        groups[doc].push(c);
    });

    const splitCases = [];
    
    Object.entries(groups).forEach(([doc, list]) => {
        if (list.length < 2) return;
        
        list.sort((a, b) => {
            const d1 = a.fecha_de_firma ? new Date(a.fecha_de_firma).getTime() : 0;
            const d2 = b.fecha_de_firma ? new Date(b.fecha_de_firma).getTime() : 0;
            return d1 - d2;
        });

        const suspiciousGroups = [];
        let currentGroup = [list[0]];

        for (let i = 1; i < list.length; i++) {
            const prev = list[i - 1];
            const curr = list[i];
            
            const prevTime = prev.fecha_de_firma ? new Date(prev.fecha_de_firma).getTime() : 0;
            const currTime = curr.fecha_de_firma ? new Date(curr.fecha_de_firma).getTime() : 0;
            
            const diffDays = (currTime - prevTime) / (1000 * 60 * 60 * 24);

            const isDirectOrMin = (c) => {
                const m = (c.modalidad_de_contratacion || "").toLowerCase();
                return m.includes("directa") || m.includes("mínima") || m.includes("minima");
            };

            if (diffDays <= 30 && isDirectOrMin(prev) && isDirectOrMin(curr)) {
                if (!currentGroup.includes(prev)) {
                    currentGroup.push(prev);
                }
                currentGroup.push(curr);
            } else {
                if (currentGroup.length >= 2) {
                    suspiciousGroups.push([...currentGroup]);
                }
                currentGroup = [curr];
            }
        }
        if (currentGroup.length >= 2) {
            suspiciousGroups.push([...currentGroup]);
        }

        if (suspiciousGroups.length > 0) {
            suspiciousGroups.forEach(grp => {
                const uniqueGrp = Array.from(new Set(grp));
                if (uniqueGrp.length >= 2) {
                    const totalVal = uniqueGrp.reduce((sum, c) => sum + (parseFloat(c.valor_del_contrato) || 0), 0);
                    splitCases.push({
                        proveedor: uniqueGrp[0].proveedor_adjudicado,
                        documento: doc,
                        contratos: uniqueGrp,
                        total_valor: totalVal,
                        count: uniqueGrp.length
                    });
                }
            });
        }
    });

    return splitCases.sort((a, b) => b.total_valor - a.total_valor);
};

const detectHighValueDirect = (contracts) => {
    return contracts.filter(c => {
        const m = (c.modalidad_de_contratacion || "").toLowerCase();
        const val = parseFloat(c.valor_del_contrato) || 0;
        return m.includes("directa") && val > 150000000;
    }).sort((a, b) => (parseFloat(b.valor_del_contrato) || 0) - (parseFloat(a.valor_del_contrato) || 0));
};

const inspectContract = (c, allContractsList) => {
    const findings = [];
    const val = parseFloat(c.valor_del_contrato) || 0;
    const mod = (c.modalidad_de_contratacion || "").toLowerCase();
    
    // Check for High Value Direct Contract
    if (mod.includes("directa") && val > 150000000) {
        findings.push({
            tipo: "Contratación Directa de Alto Valor",
            norma: "Artículo 2 Numeral 4 Ley 1150 de 2007 (Selección Objetiva)",
            gravedad: "Alta",
            explicacion: `El contrato fue adjudicado de forma directa por un valor de $${val.toLocaleString('es-CO')}. De acuerdo con la Ley 1150 de 2007, la contratación directa es excepcional. Adjudicar montos elevados directamente sin concurso público limita la competencia, transparencia y la selección objetiva.`
        });
    }
    
    // Check for Splitting (Fraccionamiento)
    const doc = c.documento_proveedor;
    if (doc && doc !== "No Definido") {
        const contractorContracts = allContractsList.filter(other => 
            other.documento_proveedor === doc && 
            other.id_contrato !== c.id_contrato
        );
        
        const cTime = c.fecha_de_firma ? new Date(c.fecha_de_firma).getTime() : 0;
        
        const isDirectOrMin = (contract) => {
            const m = (contract.modalidad_de_contratacion || "").toLowerCase();
            return m.includes("directa") || m.includes("mínima") || m.includes("minima");
        };
        
        if (isDirectOrMin(c)) {
            const splitPartners = contractorContracts.filter(other => {
                if (!isDirectOrMin(other)) return false;
                const otherTime = other.fecha_de_firma ? new Date(other.fecha_de_firma).getTime() : 0;
                const diffDays = Math.abs(cTime - otherTime) / (1000 * 60 * 60 * 24);
                return diffDays <= 30;
            });
            
            if (splitPartners.length > 0) {
                const partnerIDs = splitPartners.map(p => p.id_contrato).join(", ");
                findings.push({
                    tipo: "Posible Fraccionamiento de Contratos",
                    norma: "Artículo 24 Ley 80 de 1993 (Transparencia) y Artículo 2 Ley 1150 de 2007",
                    gravedad: "Alta",
                    explicacion: `Se identificó otro contrato directo o mínima cuantía firmado con el mismo contratista en una ventana menor a 30 días (ID de proceso involucrado: ${partnerIDs}). Esto evade los procesos competitivos reglamentarios.`
                });
            }
        }
    }
    
    // Check for Express / fast minima cuantia
    const isMinima = mod.includes("mínima") || mod.includes("minima");
    if (isMinima && val > 50000000) {
        findings.push({
            tipo: "Celeridad Inusual / Mínima Cuantía Alta",
            norma: "Decreto 1082 de 2015 (Pluralidad de Oferentes)",
            gravedad: "Media",
            explicacion: `Adjudicación bajo modalidad de Mínima Cuantía por valor elevado de $${val.toLocaleString('es-CO')}. De acuerdo al Decreto 1082 de 2015, los plazos mínimos deben garantizar la participación real de oferentes. La celeridad extrema en montos significativos puede indicar direccionamiento contractual.`
        });
    }
    
    return findings;
};

export default function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(!!sessionStorage.getItem("authToken"));
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loginError, setLoginError] = useState("");
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoginError("");
        setIsLoggingIn(true);
        try {
            const res = await fetch("/api/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ username, password })
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.detail || "Error al iniciar sesión");
            }
            const data = await res.json();
            sessionStorage.setItem("authToken", data.token);
            setIsAuthenticated(true);
        } catch (err) {
            setLoginError(err.message);
        } finally {
            setIsLoggingIn(false);
        }
    };

    const handleLogout = () => {
        sessionStorage.removeItem("authToken");
        setIsAuthenticated(false);
    };

    const [entity, setEntity] = useState("pnn");
    const [allContracts, setAllContracts] = useState([]);
    const [filteredContracts, setFilteredContracts] = useState([]);
    const [dependencies, setDependencies] = useState([]);
    const [selectedDependency, setSelectedDependency] = useState("");
    
    // Filtros adicionales e interactivos
    const [searchVal, setSearchVal] = useState("");
    const [modalityFilter, setModalityFilter] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    
    // Semáforos de riesgo
    const [filterRojo, setFilterRojo] = useState(true);
    const [filterNaranja, setFilterNaranja] = useState(true);
    const [filterVerde, setFilterVerde] = useState(true);
    
    // Filtro por mes del gráfico de picos
    const [selectedMonthFilter, setSelectedMonthFilter] = useState(null); // { year, month }
    
    // Navegación y Pestañas
    const [activeTab, setActiveTab] = useState("explorer");
    
    // Paginación (6 tarjetas por página en grilla de 3 columnas)
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 6;

    // Tarjetas expandidas
    const [expandedCards, setExpandedCards] = useState({});

    // Fila expandida en Panel de Auditoría
    const [expandedRow, setExpandedRow] = useState(null);

    // Vista de línea de tiempo del contratista (NIT)
    const [activeTimelineContractor, setActiveTimelineContractor] = useState(null);

    // Modal de Dictamen IA RAG
    const [aiAuditContractId, setAiAuditContractId] = useState(null);
    const [aiAuditLoading, setAiAuditLoading] = useState(false);
    const [aiAuditReport, setAiAuditReport] = useState("");

    // Cargando / Estado
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState("");

    // Referencias para gráficos
    const modalityChartRef = useRef(null);
    const contractorsChartRef = useRef(null);
    const modalityChartInst = useRef(null);
    const contractorsChartInst = useRef(null);

    // Cargar datos
    useEffect(() => {
        if (!isAuthenticated) return;
        async function fetchContracts() {
            setIsLoading(true);
            setErrorMessage("");
            try {
                const response = await fetch(`/api/contratos/${entity}`, {
                    headers: {
                        "X-Session-Token": sessionStorage.getItem("authToken") || ""
                    }
                });
                if (!response.ok) {
                    if (response.status === 401) {
                        handleLogout();
                        throw new Error("Sesión no autorizada o expirada.");
                    }
                    throw new Error("No se pudo obtener la respuesta del servidor API.");
                }
                const data = await response.json();
                // Filtrar estrictamente por el periodo presidencial de Gustavo Petro (7 de agosto 2022 en adelante)
                const petroContracts = data.filter(c => getGovPeriod(c.fecha_de_firma) === "petro");
                setAllContracts(petroContracts);
                setFilteredContracts(petroContracts);
                
                // Extraer dependencias únicas
                const deps = Array.from(new Set(petroContracts.map(c => c.dependencia_identificada)))
                    .sort((a, b) => a.localeCompare(b));
                setDependencies(deps);
                
                setIsLoading(false);
            } catch (err) {
                console.error(err);
                setErrorMessage(err.message);
                setIsLoading(false);
            }
        }
        fetchContracts();
    }, [entity, isAuthenticated]);

    // Lucide icons
    useEffect(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }, [isLoading, filteredContracts, expandedCards, activeTimelineContractor, aiAuditReport]);

    // Re-filtrar datos cuando cambian los filtros
    useEffect(() => {
        let temp = [...allContracts];

        // Filtro por dependencia
        if (selectedDependency) {
            temp = temp.filter(c => c.dependencia_identificada === selectedDependency);
        }

        // Filtro por modalidad
        if (modalityFilter) {
            temp = temp.filter(c => c.modalidad_de_contratacion === modalityFilter);
        }

        // Filtro por rango de fechas (fecha_de_firma)
        if (startDate) {
            temp = temp.filter(c => {
                if (!c.fecha_de_firma) return false;
                const sigDate = c.fecha_de_firma.split("T")[0];
                return sigDate >= startDate;
            });
        }
        if (endDate) {
            temp = temp.filter(c => {
                if (!c.fecha_de_firma) return false;
                const sigDate = c.fecha_de_firma.split("T")[0];
                return sigDate <= endDate;
            });
        }

        // Filtro por mes del gráfico de picos
        if (selectedMonthFilter) {
            temp = temp.filter(c => {
                if (!c.fecha_de_firma) return false;
                const dt = new Date(c.fecha_de_firma);
                return !isNaN(dt.getTime()) && 
                       dt.getFullYear() === selectedMonthFilter.year && 
                       (dt.getMonth() + 1) === selectedMonthFilter.month;
            });
        }

        // Filtro por semáforo de riesgo
        temp = temp.filter(c => {
            const score = c.riesgo_total_score || 0;
            if (score >= 70) return filterRojo;
            if (score >= 30) return filterNaranja;
            return filterVerde;
        });

        // Filtro por barra de búsqueda (Entidad, Contratista, Objeto, ID)
        if (searchVal.trim()) {
            const s = searchVal.toLowerCase().trim();
            temp = temp.filter(c => 
                (c.proveedor_adjudicado || "").toLowerCase().includes(s) ||
                (c.descripcion_del_proceso || "").toLowerCase().includes(s) ||
                (c.id_contrato || "").toLowerCase().includes(s) ||
                (c.documento_proveedor || "").toLowerCase().includes(s)
            );
        }

        setFilteredContracts(temp);
        setCurrentPage(1);
        setExpandedCards({});
    }, [selectedDependency, searchVal, modalityFilter, startDate, endDate, filterRojo, filterNaranja, filterVerde, selectedMonthFilter, allContracts]);

    // Dibujar gráficos cuando cambian los contratos filtrados
    useEffect(() => {
        if (filteredContracts.length === 0 || isLoading) return;

        // 1. Gráfico de Modalidades
        const modalitiesMap = {};
        filteredContracts.forEach(c => {
            const mod = c.modalidad_de_contratacion || "No Especificado";
            modalitiesMap[mod] = (modalitiesMap[mod] || 0) + 1;
        });
        
        const modLabels = Object.keys(modalitiesMap);
        const modData = Object.values(modalitiesMap);

        if (modalityChartInst.current) {
            modalityChartInst.current.destroy();
        }

        const ctxMod = modalityChartRef.current.getContext("2d");
        modalityChartInst.current = new Chart(ctxMod, {
            type: "doughnut",
            data: {
                labels: modLabels,
                datasets: [{
                    data: modData,
                    backgroundColor: [
                        "#6366f1", "#a855f7", "#10b981", "#f59e0b", "#ef4444", "#64748b"
                    ],
                    borderColor: "rgba(30, 41, 59, 0.8)",
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { color: "#94a3b8", font: { size: 10 } }
                    }
                }
            }
        });

        // 2. Gráfico de Top Contratistas
        const contractorsMap = {};
        filteredContracts.forEach(c => {
            const prov = c.proveedor_adjudicado || "No Adjudicado";
            const val = parseFloat(c.valor_del_contrato) || 0;
            contractorsMap[prov] = (contractorsMap[prov] || 0) + val;
        });

        const topContractors = Object.entries(contractorsMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const cLabels = topContractors.map(item => {
            const name = item[0];
            return name.length > 20 ? name.substring(0, 18) + "..." : name;
        });
        const cData = topContractors.map(item => (item[1] / 1000000).toFixed(1)); // Millones COP

        if (contractorsChartInst.current) {
            contractorsChartInst.current.destroy();
        }

        const ctxCont = contractorsChartRef.current.getContext("2d");
        contractorsChartInst.current = new Chart(ctxCont, {
            type: "bar",
            data: {
                labels: cLabels,
                datasets: [{
                    label: "Monto (Millones COP)",
                    data: cData,
                    backgroundColor: "#8b5cf6",
                    borderRadius: 6
                }]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.05)" } },
                    y: { ticks: { color: "#f8fafc" }, grid: { display: false } }
                }
            }
        });

    }, [filteredContracts, isLoading]);

    // Generar picos de contratación mes a mes
    const getMonthChartData = () => {
        const counts = {};
        allContracts.forEach(c => {
            if (c.fecha_de_firma) {
                const dt = new Date(c.fecha_de_firma);
                if (!isNaN(dt.getTime())) {
                    const yr = dt.getFullYear();
                    const m = dt.getMonth() + 1;
                    const key = `${yr}-${m.toString().padStart(2, '0')}`;
                    counts[key] = (counts[key] || 0) + 1;
                }
            }
        });
        
        return Object.entries(counts)
            .map(([key, val]) => {
                const [yr, m] = key.split("-").map(Number);
                return { key, year: yr, month: m, count: val };
            })
            .sort((a, b) => a.key.localeCompare(b.key));
    };

    // Obtener top 5 contratistas de mayor riesgo
    const getTopRiskContractors = () => {
        const summary = {};
        allContracts.forEach(c => {
            const doc = c.documento_proveedor;
            if (doc && doc !== "No Definido") {
                if (!summary[doc]) {
                    summary[doc] = {
                        documento: doc,
                        nombre: c.proveedor_adjudicado,
                        total_contracts: 0,
                        avg_score: 0,
                        total_score: 0,
                        critical_count: 0
                    };
                }
                summary[doc].total_contracts += 1;
                summary[doc].total_score += (c.riesgo_total_score || 0);
                if ((c.riesgo_total_score || 0) >= 70) {
                    summary[doc].critical_count += 1;
                }
            }
        });
        
        return Object.values(summary)
            .map(s => {
                s.avg_score = s.total_contracts > 0 ? (s.total_score / s.total_contracts) : 0;
                return s;
            })
            .sort((a, b) => b.total_score - a.total_score)
            .slice(0, 5);
    };

    // Generar Dictamen IA mediante POST
    const generateAiAudit = async (id_contrato) => {
        setAiAuditContractId(id_contrato);
        setAiAuditLoading(true);
        setAiAuditReport("");
        try {
            const res = await fetch(`/api/auditoria-ia/${entity}/${id_contrato}`, {
                method: 'POST',
                headers: {
                    "X-Session-Token": sessionStorage.getItem("authToken") || ""
                }
            });
            if (!res.ok) throw new Error("Error obteniendo la respuesta del servidor de IA.");
            const data = await res.json();
            setAiAuditReport(data.report_markdown || "No se generó dictamen.");
        } catch (err) {
            console.error(err);
            setAiAuditReport(`### Error al generar auditoría RAG\n${err.message}`);
        } finally {
            setAiAuditLoading(false);
        }
    };

    // Renderizar el drawer lateral de línea de tiempo
    const renderTimelineDrawer = () => {
        if (!activeTimelineContractor) return null;
        
        const contractorContracts = allContracts.filter(c => c.documento_proveedor === activeTimelineContractor)
            .sort((a, b) => {
                const da = a.fecha_de_firma ? new Date(a.fecha_de_firma).getTime() : 0;
                const db = b.fecha_de_firma ? new Date(b.fecha_de_firma).getTime() : 0;
                return da - db;
            });
        
        const contractorName = contractorContracts[0]?.proveedor_adjudicado || "Contratista";
        
        const getTimelineFlags = (c, idx) => {
            if (idx === 0) return false;
            const prev = contractorContracts[idx - 1];
            const cTime = c.fecha_de_firma ? new Date(c.fecha_de_firma).getTime() : 0;
            const prevTime = prev.fecha_de_firma ? new Date(prev.fecha_de_firma).getTime() : 0;
            const diffDays = Math.abs(cTime - prevTime) / (1000 * 60 * 60 * 24);
            
            const isDirectOrMin = (contract) => {
                const m = (contract.modalidad_de_contratacion || "").toLowerCase();
                return m.includes("directa") || m.includes("mínima") || m.includes("minima");
            };
            
            return diffDays < 45 && isDirectOrMin(c) && isDirectOrMin(prev);
        };

        return (
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex justify-end">
                <div className="w-full max-w-lg bg-slate-900 border-l border-white/10 h-full p-6 shadow-2xl flex flex-col justify-between overflow-y-auto no-scrollbar">
                    <div className="space-y-6">
                        <div className="flex justify-between items-start border-b border-white/5 pb-4">
                            <div>
                                <h3 className="text-sm font-bold font-outfit text-slate-100">Línea de Tiempo del Contratista</h3>
                                <p className="text-xs text-indigo-400 mt-1 font-mono font-bold">{contractorName}</p>
                                <p className="text-[10px] text-slate-400">NIT/CC: {activeTimelineContractor}</p>
                            </div>
                            <button 
                                onClick={() => setActiveTimelineContractor(null)} 
                                className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition"
                            >
                                <i data-lucide="x" className="w-5 h-5"></i>
                            </button>
                        </div>
                        
                        <div className="relative pl-6 border-l border-white/10 space-y-6">
                            {contractorContracts.map((c, idx) => {
                                const isAlert = getTimelineFlags(c, idx);
                                const score = c.riesgo_total_score || 0;
                                
                                return (
                                    <div key={c.id_contrato} className="relative">
                                        <div className={`absolute -left-[31px] top-1.5 w-4 h-4 rounded-full border-4 border-slate-900 ${isAlert ? 'bg-red-500 shadow shadow-red-500/50' : 'bg-indigo-500'}`}></div>
                                        
                                        <div className="glass-card p-4 rounded-xl space-y-2 text-xs">
                                            <div className="flex justify-between items-center gap-2">
                                                <span className="font-mono text-indigo-300 text-[10px]">{c.id_contrato}</span>
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${score >= 70 ? 'bg-red-500/20 text-red-400 border border-red-500/10' : score >= 30 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/10' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/10'}`}>
                                                    Score: {score}
                                                </span>
                                            </div>
                                            <p className="text-slate-200 font-semibold line-clamp-2">{c.descripcion_del_proceso}</p>
                                            <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                                                <span>Monto: <strong className="text-emerald-400">{currencyFormatter.format(parseFloat(c.valor_del_contrato) || 0)}</strong></span>
                                                <span>Firma: <strong>{c.fecha_de_firma ? c.fecha_de_firma.split("T")[0] : "N/A"}</strong></span>
                                            </div>
                                            
                                            {isAlert && (
                                                <div className="p-2 rounded bg-red-950/40 border border-red-500/20 text-[10px] text-red-300 font-inter flex items-start gap-1.5">
                                                    <i data-lucide="alert-triangle" className="w-3.5 h-3.5 shrink-0 mt-0.5"></i>
                                                    <span>Posible Fraccionamiento: Adjudicado en menos de 45 días del contrato anterior.</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    
                    <div className="pt-4 border-t border-white/5 mt-6">
                        <button 
                            onClick={() => setActiveTimelineContractor(null)} 
                            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg transition text-xs font-outfit"
                        >
                            Cerrar Vista Lateral
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Renderizar el modal de dictamen IA
    const renderAiAuditModal = () => {
        if (!aiAuditContractId) return null;
        
        return (
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col max-h-[85vh]">
                    <div className="flex justify-between items-start border-b border-white/5 pb-4 mb-4">
                        <div className="flex items-center gap-2">
                            <i data-lucide="sparkles" className="w-5 h-5 text-indigo-400"></i>
                            <h3 className="text-sm font-bold font-outfit text-slate-100">Dictamen de Auditoría Contractual RAG (Gemini)</h3>
                        </div>
                        <button 
                            onClick={() => setAiAuditContractId(null)} 
                            className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition"
                        >
                            <i data-lucide="x" className="w-5 h-5"></i>
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto pr-2 no-scrollbar text-slate-300 text-xs leading-relaxed space-y-4">
                        {aiAuditLoading ? (
                            <div className="flex flex-col items-center justify-center py-16 space-y-4">
                                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500"></div>
                                <p className="text-indigo-400 font-outfit text-sm">Consultando al auditor legal IA y consolidando leyes...</p>
                            </div>
                        ) : (
                            <div className="prose prose-invert max-w-none text-[11px] space-y-3 font-inter">
                                {aiAuditReport.split("\n").map((line, idx) => {
                                    if (line.startsWith("# ")) {
                                        return <h1 key={idx} className="text-base font-bold text-slate-100 font-outfit mt-4 border-b border-white/5 pb-1">{line.replace("# ", "")}</h1>;
                                    }
                                    if (line.startsWith("## ")) {
                                        return <h2 key={idx} className="text-sm font-bold text-slate-200 font-outfit mt-4 border-b border-white/5 pb-1">{line.replace("## ", "")}</h2>;
                                    }
                                    if (line.startsWith("### ")) {
                                        return <h3 key={idx} className="text-xs font-bold text-indigo-300 font-outfit mt-3">{line.replace("### ", "")}</h3>;
                                    }
                                    if (line.startsWith("* ")) {
                                        return <li key={idx} className="ml-4 list-disc text-slate-300 text-[11px]">{line.replace("* ", "")}</li>;
                                    }
                                    if (line.startsWith("1. ") || line.startsWith("2. ") || line.startsWith("3. ")) {
                                        return <li key={idx} className="ml-4 list-decimal text-slate-300 text-[11px]">{line}</li>;
                                    }
                                    if (line.trim() === "---") {
                                        return <hr key={idx} className="border-t border-white/5 my-4" />;
                                    }
                                    return <p key={idx} className="text-slate-400 mt-1">{line}</p>;
                                })}
                            </div>
                        )}
                    </div>
                    
                    <div className="pt-4 border-t border-white/5 mt-4 flex justify-end">
                        <button 
                            onClick={() => setAiAuditContractId(null)} 
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition text-xs font-outfit"
                        >
                            Cerrar Dictamen
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Cálculos Financieros y Estadísticas
    const contractCount = filteredContracts.length;
    const totalValue = filteredContracts.reduce((sum, c) => sum + (parseFloat(c.valor_del_contrato) || 0), 0);
    const averageValue = contractCount > 0 ? totalValue / contractCount : 0;

    const currencyFormatter = new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        minimumFractionDigits: 0
    });

    // Paginación
    const totalPages = Math.ceil(contractCount / itemsPerPage) || 1;
    const paginatedContracts = filteredContracts.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // Obtener modalidades de contratación únicas
    const allModalities = Array.from(new Set(allContracts.map(c => c.modalidad_de_contratacion)))
        .filter(Boolean);

    // Obtener casos de auditoría legal
    const splittingCases = detectSplitting(filteredContracts);
    const highValueDirect = detectHighValueDirect(filteredContracts);
    const totalAlertsCount = splittingCases.reduce((sum, c) => sum + c.count, 0) + highValueDirect.length;

    const getDependencyRiskStats = () => {
        const stats = {};
        
        // Initialize for all dependencies with 0
        dependencies.forEach(dep => {
            stats[dep] = { total: 0, alerts: 0 };
        });
        // Initialize for transversal
        stats["Dependencia No Especificada / Transversal"] = { total: 0, alerts: 0 };
        
        // Aggregate
        allContracts.forEach(c => {
            const dep = c.dependencia_identificada || "Dependencia No Especificada / Transversal";
            if (!stats[dep]) {
                stats[dep] = { total: 0, alerts: 0 };
            }
            stats[dep].total += 1;
            
            const findings = inspectContract(c, allContracts);
            if (findings.length > 0) {
                stats[dep].alerts += 1;
            }
        });
        
        return Object.entries(stats).map(([dep, val]) => {
            const pct = val.total > 0 ? (val.alerts / val.total * 100) : 0;
            return {
                dependencia: dep,
                total: val.total,
                alerts: val.alerts,
                percentage: pct
            };
        }).sort((a, b) => b.alerts - a.alerts);
    };

    if (!isAuthenticated) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-[#0b0f19] px-4 font-inter text-slate-100">
                <div className="w-full max-w-md p-8 rounded-3xl glass-card border border-white/10 shadow-2xl relative overflow-hidden space-y-6">
                    {/* Decorative glowing gradient */}
                    <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-500/10 blur-[80px] rounded-full"></div>
                    <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-500/10 blur-[80px] rounded-full"></div>
                    
                    <div className="text-center space-y-2">
                        <div className="inline-flex p-3.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-2xl mb-2">
                            <svg className="w-8.5 h-8.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                            </svg>
                        </div>
                        <h2 className="text-xl font-bold font-outfit text-slate-100">Auditoría Contractual SODA</h2>
                        <p className="text-xs text-slate-400">Ingresa tus credenciales para acceder al panel de control</p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-300">Usuario</label>
                            <div className="relative">
                                <input 
                                    type="text" 
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="Ingresa tu usuario"
                                    required
                                    className="w-full p-3 pl-10 glass-input rounded-xl text-sm border border-white/10 bg-white/5 focus:border-indigo-500/50 outline-none transition"
                                />
                                <span className="absolute left-3.5 top-3.5 text-slate-400">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                                    </svg>
                                </span>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-300">Contraseña</label>
                            <div className="relative">
                                <input 
                                    type="password" 
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Ingresa tu contraseña"
                                    required
                                    className="w-full p-3 pl-10 glass-input rounded-xl text-sm border border-white/10 bg-white/5 focus:border-indigo-500/50 outline-none transition"
                                />
                                <span className="absolute left-3.5 top-3.5 text-slate-400">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                                    </svg>
                                </span>
                            </div>
                        </div>

                        {loginError && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl flex items-center gap-2">
                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                                </svg>
                                <span>{loginError}</span>
                            </div>
                        )}

                        <button 
                            type="submit" 
                            disabled={isLoggingIn}
                            className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl transition shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/30 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                        >
                            {isLoggingIn ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                    <span>Verificando...</span>
                                </>
                            ) : (
                                <span>Iniciar Sesión</span>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mb-4"></div>
                <p className="text-indigo-400 font-outfit text-lg">Iniciando consulta y clasificación de dependencias...</p>
            </div>
        );
    }

    if (errorMessage) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen">
                <div className="glass-card p-8 rounded-2xl border-red-500/20 max-w-md text-center">
                    <i data-lucide="shield-alert" className="w-16 h-16 text-red-500 mx-auto mb-4"></i>
                    <h3 className="text-xl font-outfit font-bold text-red-400 mb-2">Error de Conexión</h3>
                    <p className="text-slate-300 text-sm mb-4">{errorMessage}</p>
                    <button onClick={() => window.location.reload()} className="px-4 py-2 bg-red-600 rounded-lg hover:bg-red-700 transition">Reintentar</button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Cabecera */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-card p-6 rounded-2xl border-indigo-500/10">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-indigo-600/20 text-indigo-400 rounded-xl">
                            <i data-lucide="shield-check" className="w-8 h-8"></i>
                        </div>
                        <div>
                            <h1 className="text-2xl font-outfit font-bold text-slate-100">
                                {entity === "pnn" ? "Parques Nacionales Naturales" : "Ministerio de Ambiente"}
                            </h1>
                            <p className="text-xs text-indigo-400 font-medium">Clasificación de Contratos por Dependencia (SODA API)</p>
                        </div>
                    </div>
                    
                    {/* Selector de Entidad */}
                    <div className="flex items-center gap-2 md:ml-6">
                        <label className="text-xs font-semibold text-slate-400 font-outfit">Entidad:</label>
                        <select 
                            value={entity}
                            onChange={(e) => setEntity(e.target.value)}
                            className="p-2 glass-input rounded-xl text-xs font-bold font-outfit text-indigo-300"
                        >
                            <option value="pnn">Parques Nacionales Naturales (PNN)</option>
                            <option value="minambiente">Ministerio de Ambiente</option>
                        </select>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-full text-xs font-semibold">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 pulse"></span>
                        API Sincronizada con SECOP II
                    </div>
                    
                    <button 
                        onClick={handleLogout}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded-xl text-xs font-bold font-outfit border border-red-500/10 transition"
                    >
                        <i data-lucide="log-out" className="w-4 h-4"></i>
                        Cerrar Sesión
                    </button>
                </div>
            </header>

            {/* Navigation Tabs */}
            <div className="flex border-b border-white/10 gap-6 text-sm font-semibold font-outfit mt-4">
                <button 
                    onClick={() => setActiveTab("explorer")}
                    className={`pb-3 px-1 flex items-center gap-2 border-b-2 transition ${activeTab === "explorer" ? "border-indigo-500 text-indigo-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                >
                    <i data-lucide="layers" className="w-4 h-4"></i>
                    Explorador General
                </button>
                <button 
                    onClick={() => setActiveTab("audit")}
                    className={`pb-3 px-1 flex items-center gap-2 border-b-2 transition ${activeTab === "audit" ? "border-indigo-500 text-indigo-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                >
                    <i data-lucide="shield-alert" className="w-4 h-4"></i>
                    Panel de Auditoría Legal e Inconsistencias
                </button>
            </div>

            {activeTab === "explorer" ? (
                <>
                    {/* Filtros */}
                    <section className="glass-card p-6 rounded-2xl space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                            <div className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-300">Dependencia Responsable (Motor RegEx)</label>
                                <select 
                                    value={selectedDependency}
                                    onChange={(e) => setSelectedDependency(e.target.value)}
                                    className="w-full p-3 glass-input rounded-xl text-sm"
                                >
                                    <option value="">Todas las Dependencias ({allContracts.length} contratos)</option>
                                    {dependencies.map(dep => {
                                        const count = allContracts.filter(c => c.dependencia_identificada === dep).length;
                                        return (
                                            <option key={dep} value={dep}>{dep} ({count})</option>
                                        );
                                    })}
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-300">Modalidad de Contratación</label>
                                <select 
                                    value={modalityFilter}
                                    onChange={(e) => setModalityFilter(e.target.value)}
                                    className="w-full p-3 glass-input rounded-xl text-sm"
                                >
                                    <option value="">Todas las modalidades</option>
                                    {allModalities.map(mod => (
                                        <option key={mod} value={mod}>{mod}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-300">Buscador Rápido</label>
                                <div className="relative w-full">
                                    <input 
                                        type="text" 
                                        value={searchVal}
                                        onChange={(e) => setSearchVal(e.target.value)}
                                        placeholder="Buscar por contratista, descripción, NIT..."
                                        className="w-full p-3 pl-10 glass-input rounded-xl text-sm"
                                    />
                                    <i data-lucide="search" className="w-4 h-4 text-slate-400 absolute left-3 top-3.5"></i>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4 border-t border-white/5 items-center">
                            {/* Temporal quick filter dates */}
                            <div className="space-y-3">
                                <label className="block text-xs font-semibold text-slate-300">Rango de Fechas (Firma de Contrato)</label>
                                <div className="flex items-center gap-3">
                                    <input 
                                        type="date" 
                                        value={startDate} 
                                        onChange={(e) => { setStartDate(e.target.value); setSelectedMonthFilter(null); }} 
                                        className="p-2 bg-black/30 border border-white/10 rounded-lg text-xs text-slate-200" 
                                    />
                                    <span className="text-xs text-slate-400">hasta</span>
                                    <input 
                                        type="date" 
                                        value={endDate} 
                                        onChange={(e) => { setEndDate(e.target.value); setSelectedMonthFilter(null); }} 
                                        className="p-2 bg-black/30 border border-white/10 rounded-lg text-xs text-slate-200" 
                                    />
                                    
                                    {/* Clear dates button */}
                                    {(startDate || endDate || selectedMonthFilter) && (
                                        <button 
                                            onClick={() => { setStartDate(""); setEndDate(""); setSelectedMonthFilter(null); }}
                                            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-lg text-indigo-400 transition"
                                        >
                                            Limpiar Fechas
                                        </button>
                                    )}
                                </div>
                                {/* Quick buttons */}
                                <div className="flex gap-2 flex-wrap">
                                    <button 
                                        onClick={() => { setStartDate("2023-01-01"); setEndDate("2023-06-30"); setSelectedMonthFilter(null); }}
                                        className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded text-[10px] text-slate-300 font-mono transition"
                                    >
                                        Este Semestre
                                    </button>
                                    <button 
                                        onClick={() => { setStartDate("2023-01-01"); setEndDate("2023-12-31"); setSelectedMonthFilter(null); }}
                                        className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded text-[10px] text-slate-300 font-mono transition"
                                    >
                                        Año Electoral 2023
                                    </button>
                                    <button 
                                        onClick={() => { setStartDate("2023-05-30"); setEndDate("2023-06-29"); setSelectedMonthFilter(null); }}
                                        className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded text-[10px] text-slate-300 font-mono transition"
                                    >
                                        Periodo Pre-Ley de Garantías
                                    </button>
                                </div>
                            </div>

                            {/* Risk Toggles (Semáforos) */}
                            <div className="space-y-3">
                                <label className="block text-xs font-semibold text-slate-300">Semáforo de Riesgo (Filtro por Tasa)</label>
                                <div className="flex gap-3">
                                    <button 
                                        onClick={() => setFilterRojo(!filterRojo)}
                                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold font-outfit transition ${filterRojo ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-transparent text-slate-500 border-white/5'}`}
                                    >
                                        <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                                        Críticos (≥70)
                                    </button>
                                    <button 
                                        onClick={() => setFilterNaranja(!filterNaranja)}
                                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold font-outfit transition ${filterNaranja ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-transparent text-slate-500 border-white/5'}`}
                                    >
                                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                                        Medios (30-69)
                                    </button>
                                    <button 
                                        onClick={() => setFilterVerde(!filterVerde)}
                                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold font-outfit transition ${filterVerde ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-transparent text-slate-500 border-white/5'}`}
                                    >
                                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                                        Bajos (&lt;30)
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* KPIs */}
                    <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="glass-card p-6 rounded-2xl flex items-center gap-4">
                            <div className="p-4 bg-indigo-600/10 text-indigo-400 rounded-xl">
                                <i data-lucide="dollar-sign" className="w-8 h-8"></i>
                            </div>
                            <div>
                                <span className="text-xs text-slate-400 block font-medium">Monto Total Adjudicado</span>
                                <h3 className="text-xl md:text-2xl font-bold font-outfit text-indigo-300">{currencyFormatter.format(totalValue)}</h3>
                            </div>
                        </div>

                        <div className="glass-card p-6 rounded-2xl flex items-center gap-4">
                            <div className="p-4 bg-purple-600/10 text-purple-400 rounded-xl">
                                <i data-lucide="file-text" className="w-8 h-8"></i>
                            </div>
                            <div>
                                <span className="text-xs text-slate-400 block font-medium">Contratos Analizados</span>
                                <h3 className="text-xl md:text-2xl font-bold font-outfit text-purple-300">{contractCount.toLocaleString()}</h3>
                            </div>
                        </div>

                        <div className="glass-card p-6 rounded-2xl flex items-center gap-4">
                            <div className="p-4 bg-emerald-600/10 text-emerald-400 rounded-xl">
                                <i data-lucide="trending-up" className="w-8 h-8"></i>
                            </div>
                            <div>
                                <span className="text-xs text-slate-400 block font-medium">Valor Promedio Contrato</span>
                                <h3 className="text-xl md:text-2xl font-bold font-outfit text-emerald-300">{currencyFormatter.format(averageValue)}</h3>
                            </div>
                        </div>
                    </section>

                    {/* Gráficos */}
                    <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="glass-card p-6 rounded-2xl space-y-4">
                            <h3 className="text-sm font-semibold font-outfit text-slate-200 flex items-center gap-2 border-b border-white/5 pb-2">
                                <i data-lucide="pie-chart" className="w-4 h-4 text-indigo-400"></i> Distribución por Modalidad
                            </h3>
                            <div className="h-64 relative">
                                <canvas ref={modalityChartRef}></canvas>
                            </div>
                        </div>

                        <div className="glass-card p-6 rounded-2xl space-y-4">
                            <h3 className="text-sm font-semibold font-outfit text-slate-200 flex items-center gap-2 border-b border-white/5 pb-2">
                                <i data-lucide="bar-chart-3" className="w-4 h-4 text-purple-400"></i> Top 5 Contratistas (COP)
                            </h3>
                            <div className="h-64 relative">
                                <canvas ref={contractorsChartRef}></canvas>
                            </div>
                        </div>
                    </section>

                    {/* Histograma y Matriz de Riesgo */}
                    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Month Bar Chart */}
                        <div className="glass-card p-6 rounded-2xl lg:col-span-2 space-y-4 flex flex-col justify-between">
                            <div className="flex justify-between items-center flex-wrap gap-2 border-b border-white/5 pb-3">
                                <div>
                                    <h3 className="text-sm font-semibold font-outfit text-slate-200 flex items-center gap-2">
                                        <i data-lucide="bar-chart-3" className="w-4 h-4 text-red-400"></i> Histograma de Adjudicaciones (Picos de Contratación)
                                    </h3>
                                    <p class="text-[10px] text-slate-400 font-inter mt-0.5">Volumen mensual de firmas. Haz clic en una columna para aislar el mes. La franja roja indica Ley de Garantías.</p>
                                </div>
                                {selectedMonthFilter && (
                                    <button 
                                        onClick={() => setSelectedMonthFilter(null)}
                                        className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded text-[10px] transition shrink-0 font-outfit"
                                    >
                                        Ver Todos
                                    </button>
                                )}
                            </div>
                            
                            {/* Scrollable Month Bars */}
                            <div className="overflow-x-auto pb-2 flex gap-3 min-h-[140px] items-end no-scrollbar">
                                {getMonthChartData().map(d => {
                                    const maxCount = Math.max(...getMonthChartData().map(x => x.count), 1);
                                    const pctHeight = (d.count / maxCount * 100);
                                    const isGarantiasStart = d.year === 2023 && d.month === 6;
                                    const isSelected = selectedMonthFilter && selectedMonthFilter.year === d.year && selectedMonthFilter.month === d.month;
                                    
                                    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
                                    const label = `${monthNames[d.month - 1]} ${d.year.toString().slice(2)}`;
                                    
                                    return (
                                        <div 
                                            key={d.key} 
                                            onClick={() => {
                                                if (isSelected) {
                                                    setSelectedMonthFilter(null);
                                                } else {
                                                    setSelectedMonthFilter({ year: d.year, month: d.month });
                                                }
                                                setCurrentPage(1);
                                            }}
                                            className={`flex flex-col items-center gap-1.5 group cursor-pointer transition shrink-0 w-11`}
                                        >
                                            <div className="relative w-full h-24 flex items-end justify-center">
                                                <div 
                                                    className={`w-6 rounded-t-md transition-all duration-300 ${isSelected ? 'bg-indigo-500 shadow-lg shadow-indigo-500/40' : isGarantiasStart ? 'bg-red-500/80 group-hover:bg-red-500' : 'bg-slate-700 group-hover:bg-slate-600'}`}
                                                    style={{ height: `${pctHeight}%` }}
                                                ></div>
                                                
                                                <div className="absolute -top-6 hidden group-hover:block bg-black/90 px-1.5 py-0.5 rounded text-[8px] font-bold text-white z-10 border border-white/10 shrink-0 whitespace-nowrap">
                                                    {d.count} conts
                                                </div>
                                            </div>
                                            
                                            <span className={`text-[9px] font-semibold font-mono ${isSelected ? 'text-indigo-400 font-bold' : isGarantiasStart ? 'text-red-400 font-bold' : 'text-slate-400'}`}>
                                                {label}
                                            </span>
                                            
                                            {isGarantiasStart && (
                                                <span className="text-[7.5px] text-red-500 font-bold uppercase tracking-wider font-outfit text-center leading-none mt-0.5 whitespace-nowrap">
                                                    Restricción
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Top Contractors Side Table */}
                        <div className="glass-card p-6 rounded-2xl space-y-4">
                            <h3 className="text-sm font-semibold font-outfit text-slate-200 flex items-center gap-2 border-b border-white/5 pb-3">
                                <i data-lucide="shield-alert" className="w-4 h-4 text-amber-400"></i> Top 5 Contratistas de Mayor Riesgo
                            </h3>
                            <div className="space-y-3">
                                {getTopRiskContractors().map(c => (
                                    <div key={c.documento} className="flex items-center justify-between p-3 rounded-xl border border-white/5 bg-white/5 hover:border-indigo-500/20 transition">
                                        <div className="space-y-1">
                                            <h4 className="font-bold text-xs text-slate-200 line-clamp-1 max-w-[160px]">{c.nombre}</h4>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[9px] text-slate-400 font-mono">NIT: {c.documento}</span>
                                                <button 
                                                    onClick={() => setActiveTimelineContractor(c.documento)}
                                                    className="p-0.5 hover:text-indigo-400 text-slate-500 transition"
                                                    title="Ver Línea de Tiempo del Contratista"
                                                >
                                                    <i data-lucide="history" className="w-3 h-3"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.avg_score >= 50 ? 'bg-red-500/25 text-red-400' : 'bg-amber-500/25 text-amber-400'}`}>
                                                Risk Avg: {c.avg_score.toFixed(0)}
                                            </span>
                                            <span className="text-[8px] text-slate-400 block mt-1">{c.total_contracts} contratos</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    {/* Tabla de Detalle Reemplazada por Tarjetas de Riesgo */}
                    <section className="space-y-6">
                        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-white/5 pb-3">
                            <h3 className="text-sm font-semibold font-outfit text-slate-200 flex items-center gap-2">
                                <i data-lucide="list" className="w-4 h-4 text-emerald-400"></i> Fichas de Auditoría Contractual Analizadas
                            </h3>
                            <span className="bg-indigo-600/20 text-indigo-400 px-2.5 py-1 rounded-full text-xs font-semibold font-outfit">
                                Mostrando {contractCount.toLocaleString()} contratos
                            </span>
                        </div>

                        {/* Grid of Risk Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {paginatedContracts.map(c => {
                                const isExpanded = expandedCards[c.id_contrato];
                                const score = c.riesgo_total_score || 0;
                                
                                let riskBadge = "bg-emerald-500/20 text-emerald-400 border-emerald-500/10";
                                let scoreCircle = "border-emerald-500/40 text-emerald-400 bg-emerald-500/5";
                                if (score >= 70) {
                                    riskBadge = "bg-red-500/20 text-red-400 border-red-500/10";
                                    scoreCircle = "border-red-500/40 text-red-400 bg-red-500/5";
                                } else if (score >= 30) {
                                    riskBadge = "bg-amber-500/20 text-amber-400 border-amber-500/10";
                                    scoreCircle = "border-amber-500/40 text-amber-400 bg-amber-500/5";
                                }
                                
                                return (
                                    <div key={c.id_contrato} className="glass-card p-5 rounded-2xl flex flex-col justify-between border border-white/5 space-y-4 hover:border-indigo-500/20 transition duration-300">
                                        <div className="space-y-3">
                                            {/* Header: Score and Badge */}
                                            <div className="flex justify-between items-start gap-3">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] text-slate-400 font-mono">{c.id_contrato}</span>
                                                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border mt-1 shrink-0 text-center w-max ${riskBadge}`}>
                                                        Riesgo {c.nivel_riesgo}
                                                    </span>
                                                </div>
                                                <div className={`w-11 h-11 rounded-full border-4 flex items-center justify-center font-bold text-xs shrink-0 font-mono ${scoreCircle}`}>
                                                    {score}
                                                </div>
                                            </div>
                                            
                                            {/* Provider */}
                                            <div className="space-y-1">
                                                <span className="text-[10px] text-slate-400 block font-semibold">Contratista:</span>
                                                <h4 className="font-bold text-xs text-slate-200 line-clamp-1">{c.proveedor_adjudicado || "No Especificado"}</h4>
                                                
                                                <div className="flex items-center gap-1.5 mt-1">
                                                    <span className="text-[10px] text-slate-400 font-mono">NIT/CC: {c.documento_proveedor || "N/A"}</span>
                                                    {c.documento_proveedor && c.documento_proveedor !== "No Definido" && (
                                                        <button 
                                                            onClick={() => setActiveTimelineContractor(c.documento_proveedor)}
                                                            className="p-0.5 hover:text-indigo-400 text-slate-500 transition"
                                                            title="Ver Línea de Tiempo del Contratista"
                                                        >
                                                            <i data-lucide="history" className="w-3.5 h-3.5"></i>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            
                                            {/* Value and Modality */}
                                            <div className="grid grid-cols-2 gap-2 bg-black/10 p-2.5 rounded-lg border border-white/5 font-inter text-[11px]">
                                                <div>
                                                    <span className="text-slate-400 text-[10px] block">Monto Adjudicado:</span>
                                                    <strong className="text-emerald-400 font-semibold block mt-0.5">{currencyFormatter.format(parseFloat(c.valor_del_contrato) || 0)}</strong>
                                                </div>
                                                <div>
                                                    <span className="text-slate-400 text-[10px] block">Fecha de Firma:</span>
                                                    <strong className="text-slate-200 block mt-0.5">{c.fecha_de_firma ? c.fecha_de_firma.split("T")[0] : "N/A"}</strong>
                                                </div>
                                                <div className="col-span-2 border-t border-white/5 pt-1.5 mt-0.5">
                                                    <span className="text-slate-400 text-[10px] block">Modalidad:</span>
                                                    <strong className="text-slate-300 block truncate mt-0.5">{c.modalidad_de_contratacion}</strong>
                                                </div>
                                            </div>
                                            
                                            {/* Description object */}
                                            <div>
                                                <span className="text-[10px] text-slate-400 block font-semibold">Objeto Contractual:</span>
                                                <p className="text-slate-300 text-[11px] mt-1 line-clamp-3 leading-relaxed font-inter">{c.descripcion_del_proceso || "Sin descripción disponible."}</p>
                                            </div>
                                        </div>
                                        
                                        {/* Expanded red flags reasons block */}
                                        {isExpanded && (
                                            <div className={`p-3.5 rounded-xl border space-y-2 mt-2 ${score >= 70 ? 'border-red-500/20 bg-red-500/5' : score >= 30 ? 'border-amber-500/20 bg-amber-500/5' : 'border-emerald-500/10 bg-emerald-500/5'}`}>
                                                <h5 className={`text-[10px] font-bold flex items-center gap-1 font-outfit uppercase tracking-wider ${score >= 70 ? 'text-red-400' : score >= 30 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                                    <i data-lucide="shield-alert" className="w-3.5 h-3.5"></i>
                                                    Banderas Rojas Identificadas ({c.banderas_rojas?.length || 0})
                                                </h5>
                                                {c.banderas_rojas && c.banderas_rojas.length > 0 ? (
                                                    <div className="space-y-2.5 text-[10.5px] leading-relaxed font-inter">
                                                        {c.banderas_rojas.map((flag, idx) => (
                                                            <div key={idx} className="flex items-start gap-1.5 border-b border-white/5 pb-1.5 last:border-b-0 last:pb-0">
                                                                <span className="text-red-400 font-bold shrink-0">•</span>
                                                                <p className="text-slate-300">{flag}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-slate-400 text-[10px] font-mono">No se detectaron banderas rojas en el análisis de reglas.</p>
                                                )}
                                            </div>
                                        )}
                                        
                                        {/* Action buttons */}
                                        <div className="pt-3 border-t border-white/5 flex gap-2 justify-between items-center">
                                            <button 
                                                onClick={() => {
                                                    setExpandedCards(prev => ({
                                                        ...prev,
                                                        [c.id_contrato]: !prev[c.id_contrato]
                                                    }));
                                                }}
                                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg transition text-[10.5px] font-outfit flex items-center gap-1 shrink-0"
                                            >
                                                <i data-lucide={isExpanded ? "chevron-up" : "chevron-down"} className="w-3.5 h-3.5"></i>
                                                {isExpanded ? "Ocultar Alertas" : "Ver Análisis Legal"}
                                            </button>
                                            
                                            <div className="flex gap-2 items-center">
                                                {score >= 70 && (
                                                    <button 
                                                        onClick={() => generateAiAudit(c.id_contrato)}
                                                        className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition flex items-center justify-center"
                                                        title="Auditoría IA (Sustento Normativo)"
                                                    >
                                                        <i data-lucide="sparkles" className="w-4 h-4"></i>
                                                    </button>
                                                )}
                                                
                                                {c.proceso_de_compra && (
                                                    <a 
                                                        href={`https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=${c.proceso_de_compra}`} 
                                                        target="_blank" 
                                                        rel="noopener noreferrer" 
                                                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-400 font-bold rounded-lg transition flex items-center justify-center"
                                                        title="Ver en SECOP II"
                                                    >
                                                        <i data-lucide="external-link" className="w-4 h-4"></i>
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Paginación */}
                        <div className="flex items-center justify-between pt-4 border-t border-white/5 text-xs text-slate-400 font-outfit">
                            <div>
                                Mostrando contratos {((currentPage - 1) * itemsPerPage + 1).toLocaleString()} - {Math.min(currentPage * itemsPerPage, contractCount).toLocaleString()} de {contractCount.toLocaleString()}
                            </div>
                            <div className="flex items-center gap-3">
                                <button 
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                    className="p-2 bg-indigo-600/10 hover:bg-indigo-600/20 disabled:opacity-30 disabled:pointer-events-none rounded-lg transition"
                                >
                                    <i data-lucide="chevron-left" className="w-4 h-4"></i>
                                </button>
                                <span className="font-semibold text-slate-300">Pág. {currentPage} de {totalPages}</span>
                                <button 
                                    disabled={currentPage === totalPages}
                                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                    className="p-2 bg-indigo-600/10 hover:bg-indigo-600/20 disabled:opacity-30 disabled:pointer-events-none rounded-lg transition"
                                >
                                    <i data-lucide="chevron-right" className="w-4 h-4"></i>
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Timeline Drawers and IA Audit modals */}
                    {renderTimelineDrawer()}
                    {renderAiAuditModal()}
                </>
            ) : (
                <div className="space-y-6">
                    {/* Audit KPIs */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="glass-card p-6 rounded-2xl flex items-center gap-4">
                            <div className="p-4 bg-red-600/10 text-red-400 rounded-xl">
                                <i data-lucide="alert-triangle" className="w-8 h-8"></i>
                            </div>
                            <div>
                                <span className="text-xs text-slate-400 block font-medium">Contratos en Posible Fraccionamiento</span>
                                <h3 className="text-xl md:text-2xl font-bold font-outfit text-red-300">
                                    {splittingCases.reduce((sum, c) => sum + c.count, 0)}
                                </h3>
                            </div>
                        </div>
                        <div className="glass-card p-6 rounded-2xl flex items-center gap-4">
                            <div className="p-4 bg-amber-600/10 text-amber-400 rounded-xl">
                                <i data-lucide="shield-x" className="w-8 h-8"></i>
                            </div>
                            <div>
                                <span className="text-xs text-slate-400 block font-medium">Directas Excesivas (&gt;150M COP)</span>
                                <h3 className="text-xl md:text-2xl font-bold font-outfit text-amber-300">
                                    {highValueDirect.length}
                                </h3>
                            </div>
                        </div>
                        <div className="glass-card p-6 rounded-2xl flex items-center gap-4">
                            <div className="p-4 bg-indigo-600/10 text-indigo-400 rounded-xl">
                                <i data-lucide="info" className="w-8 h-8"></i>
                            </div>
                            <div>
                                <span className="text-xs text-slate-400 block font-medium">Total Alertas de Riesgo</span>
                                <h3 className="text-xl md:text-2xl font-bold font-outfit text-indigo-300">
                                    {totalAlertsCount}
                                </h3>
                            </div>
                        </div>
                    </div>

                    {/* Monitoreo por Dependencias */}
                    <div className="glass-card p-6 rounded-2xl space-y-4">
                        <div className="border-b border-white/5 pb-3">
                            <h3 className="text-sm font-bold font-outfit text-slate-100 flex items-center gap-2">
                                <i data-lucide="building-2" className="text-indigo-400 w-5 h-5"></i>
                                Desglose de Riesgo y Alertas por Dependencia (Control Interno)
                            </h3>
                            <p className="text-xs text-slate-400 mt-1 font-inter">
                                Porcentaje y volumen de alertas jurídicas identificadas en el total de contratos de cada dependencia del Ministerio de Ambiente (independiente del filtro activo).
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {getDependencyRiskStats().map(stat => {
                                let riskColor = "bg-emerald-500/20 text-emerald-400 border-emerald-500/10";
                                let barColor = "bg-emerald-500";
                                let riskLabel = "Bajo";
                                
                                if (stat.percentage > 25) {
                                    riskColor = "bg-red-500/20 text-red-400 border-red-500/10";
                                    barColor = "bg-red-500";
                                    riskLabel = "Alto";
                                } else if (stat.percentage > 10) {
                                    riskColor = "bg-amber-500/20 text-amber-400 border-amber-500/10";
                                    barColor = "bg-amber-500";
                                    riskLabel = "Medio";
                                } else if (stat.total === 0) {
                                    riskColor = "bg-slate-500/20 text-slate-400 border-slate-500/10";
                                    barColor = "bg-slate-500";
                                    riskLabel = "Sin Contratos";
                                }
                                
                                return (
                                    <div key={stat.dependencia} className="p-4 rounded-xl border border-white/5 bg-white/5 space-y-3 flex flex-col justify-between">
                                        <div>
                                            <div className="flex justify-between items-start gap-2">
                                                <h4 className="font-bold text-xs text-slate-200 line-clamp-2 min-h-[32px]">{stat.dependencia}</h4>
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase shrink-0 ${riskColor}`}>
                                                    {riskLabel}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs text-slate-400 mt-2 font-mono">
                                                <span>Alertas: <strong className="text-red-400">{stat.alerts}</strong></span>
                                                <span>Total: <strong>{stat.total}</strong></span>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                                                <span>Tasa de Riesgo:</span>
                                                <span className="font-bold">{stat.percentage.toFixed(1)}%</span>
                                            </div>
                                            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${stat.percentage}%` }}></div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Main audit content */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Left column: Suspected splitting cases */}
                        <div className="glass-card p-6 rounded-2xl space-y-4 flex flex-col">
                            <div className="border-b border-white/5 pb-3">
                                <h3 className="text-sm font-bold font-outfit text-slate-100 flex items-center gap-2">
                                    <i data-lucide="alert-triangle" className="text-red-400 w-5 h-5"></i>
                                    Reporte de Fraccionamiento Temporal (Ventana 30 Días)
                                </h3>
                                <p className="text-xs text-slate-400 mt-1 font-inter">
                                    Contratistas con múltiples adjudicaciones directas o mínimas cuantías firmadas con diferencias menores a 30 días.
                                </p>
                            </div>

                            {splittingCases.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center py-8">No se encontraron sospechas de fraccionamiento en el filtro activo.</p>
                            ) : (
                                <div className="space-y-4 max-h-[500px] overflow-y-auto no-scrollbar pr-1">
                                    {splittingCases.map(item => {
                                        const isExpanded = expandedRow === `split-${item.documento}`;
                                        return (
                                            <div 
                                                key={item.documento} 
                                                className={`p-4 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition cursor-pointer ${isExpanded ? 'bg-white/10 border-indigo-500/20' : ''}`}
                                                onClick={() => setExpandedRow(isExpanded ? null : `split-${item.documento}`)}
                                            >
                                                <div className="flex justify-between items-start gap-4">
                                                    <div>
                                                        <h4 className="font-bold text-xs md:text-sm text-slate-200">{item.proveedor}</h4>
                                                        <span className="text-xs text-slate-400 block mt-0.5 font-mono">NIT/C.C.: {item.documento}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-xs font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full block text-center mb-1">
                                                            {item.count} Contratos
                                                        </span>
                                                        <span className="text-xs md:text-sm font-bold text-indigo-300 font-mono block">
                                                            {currencyFormatter.format(item.total_valor)}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Expanded timeline details */}
                                                {isExpanded && (
                                                    <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
                                                        <h5 className="text-xs font-bold text-indigo-400">Línea de Tiempo de Adjudicaciones:</h5>
                                                        <div className="relative pl-6 border-l-2 border-indigo-500/30 space-y-6">
                                                            {item.contratos.map((c, idx) => {
                                                                return (
                                                                    <div key={c.id_contrato} className="relative">
                                                                        <span className="absolute -left-[32px] top-0.5 w-4 h-4 rounded-full bg-slate-900 border-2 border-indigo-500 flex items-center justify-center text-[8px] font-bold text-indigo-300 font-outfit">
                                                                            {idx + 1}
                                                                        </span>
                                                                        <div className="text-xs space-y-1">
                                                                            <div className="flex justify-between items-center flex-wrap gap-1 font-mono">
                                                                                <span className="text-slate-100 font-semibold">{c.fecha_de_firma ? c.fecha_de_firma.split("T")[0] : "N/A"}</span>
                                                                                <span className="text-emerald-400 font-bold">{currencyFormatter.format(parseFloat(c.valor_del_contrato) || 0)}</span>
                                                                            </div>
                                                                            <p className="text-slate-300 text-[11px] leading-relaxed"><strong className="text-slate-400 font-semibold">Objeto:</strong> {c.descripcion_del_proceso}</p>
                                                                            <div className="flex gap-2 text-[10px] text-slate-400 mt-1 font-mono items-center flex-wrap">
                                                                                <span>ID: {c.id_contrato}</span>
                                                                                <span>•</span>
                                                                                <span>Mod: {c.modalidad_de_contratacion}</span>
                                                                                {c.proceso_de_compra && (
                                                                                    <>
                                                                                        <span>•</span>
                                                                                        <a 
                                                                                            href={`https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=${c.proceso_de_compra}`} 
                                                                                            target="_blank" 
                                                                                            rel="noopener noreferrer" 
                                                                                            className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-0.5 transition"
                                                                                        >
                                                                                            Ver Proceso <i data-lucide="external-link" className="w-2.5 h-2.5"></i>
                                                                                        </a>
                                                                                    </>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Right column: High-value direct contracts */}
                        <div className="glass-card p-6 rounded-2xl space-y-4 flex flex-col">
                            <div className="border-b border-white/5 pb-3">
                                <h3 className="text-sm font-bold font-outfit text-slate-100 flex items-center gap-2">
                                    <i data-lucide="shield-x" className="text-amber-400 w-5 h-5"></i>
                                    Reporte de Contratos Directos Excesivos (&gt;150M COP)
                                </h3>
                                <p className="text-xs text-slate-400 mt-1 font-inter">
                                    Adjudicaciones directas con valores elevados que podrían requerir un proceso de licitación pública formal.
                                </p>
                            </div>

                            {highValueDirect.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center py-8">No se encontraron contratos directos excesivos en el filtro activo.</p>
                            ) : (
                                <div className="space-y-4 max-h-[500px] overflow-y-auto no-scrollbar pr-1">
                                    {highValueDirect.map(c => {
                                        const isExpanded = expandedRow === `high-${c.id_contrato}`;
                                        return (
                                            <div 
                                                key={c.id_contrato} 
                                                className={`p-4 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition cursor-pointer ${isExpanded ? 'bg-white/10 border-indigo-500/20' : ''}`}
                                                onClick={() => setExpandedRow(isExpanded ? null : `high-${c.id_contrato}`)}
                                            >
                                                <div className="flex justify-between items-start gap-4">
                                                    <div>
                                                        <h4 className="font-bold text-xs md:text-sm text-slate-200">{c.proveedor_adjudicado || "No Especificado"}</h4>
                                                        <span className="text-xs text-slate-400 block mt-0.5 font-mono">ID: {c.id_contrato}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-xs md:text-sm font-bold text-amber-400 font-mono block">
                                                            {currencyFormatter.format(parseFloat(c.valor_del_contrato) || 0)}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400 font-mono block">
                                                            Firma: {c.fecha_de_firma ? c.fecha_de_firma.split("T")[0] : "N/A"}
                                                        </span>
                                                    </div>
                                                </div>

                                                {isExpanded && (
                                                    <div className="mt-3 pt-3 border-t border-white/10 text-xs space-y-2 text-slate-300">
                                                        <p><strong className="text-slate-400 font-semibold">Descripción:</strong> {c.descripcion_del_proceso}</p>
                                                        <div className="grid grid-cols-2 gap-2 bg-black/10 p-2 rounded border border-white/5 font-mono text-[10px] text-slate-400 items-center">
                                                            <span>Causal: Contratación Directa</span>
                                                            <span>NIT: {c.documento_proveedor || "N/A"}</span>
                                                            <span className="col-span-2">Proceso Compra: {c.proceso_de_compra || "N/A"}</span>
                                                            {c.proceso_de_compra && (
                                                                <div className="col-span-2 pt-2 border-t border-white/5 flex justify-end">
                                                                    <a 
                                                                        href={`https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=${c.proceso_de_compra}`} 
                                                                        target="_blank" 
                                                                        rel="noopener noreferrer" 
                                                                        className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 font-bold rounded flex items-center gap-1 transition"
                                                                    >
                                                                        Ver en SECOP II <i data-lucide="external-link" className="w-3.5 h-3.5"></i>
                                                                    </a>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
