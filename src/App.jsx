import { useState, useMemo, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from './supabaseClient'
import './App.css'

const CATEGORIES = [
    'Projeto/Engenharia',
    'Terraplanagem/Terreno',
    'Material',
    'Mão de Obra',
    'Taxas/Documento',
    'Hidráulica',
    'Elétrica',
    'Acabamento',
    'Outros',
    'Transferência/Acerto'
];

function App() {
    const [expenses, setExpenses] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [theme] = useState(() => localStorage.getItem('sobrados-theme') || 'light');

    // Form states
    const [desc, setDesc] = useState('')
    const [amount, setAmount] = useState('')
    const [payer, setPayer] = useState('Vinícius')
    const [category, setCategory] = useState(CATEGORIES[0])
    const [status, setStatus] = useState('Pago')
    const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
    const [receiptFiles, setReceiptFiles] = useState([])
    const [editingId, setEditingId] = useState(null);
    const [editFormData, setEditFormData] = useState({});
    const [uploadingId, setUploadingId] = useState(null);

    // Modal States
    const [viewReceipt, setViewReceipt] = useState(null);
    const [viewSettlementDetails, setViewSettlementDetails] = useState(false);

    // Amin Mode State
    const [isAdmin, setIsAdmin] = useState(false);

    // Pagination and Filter states
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 6;

    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [filterMonth, setFilterMonth] = useState('');

    // Extract unique months from expenses for the filter dropdown
    const availableMonths = useMemo(() => {
        const months = new Set();
        expenses.forEach(exp => {
            // isoDate is YYYY-MM-DD
            const monthPrefix = exp.isoDate.substring(0, 7);
            months.add(monthPrefix);
        });
        return Array.from(months).sort().reverse(); // Show newest months first
    }, [expenses]);

    // Reset page to 1 when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, filterCategory, filterStatus, filterMonth]);

    // Load from Supabase and Subscribe to changes
    useEffect(() => {
        async function loadData() {
            try {
                // Fetch initial data
                const { data, error } = await supabase
                    .from('expenses')
                    .select('*')
                    .order('isodate', { ascending: false });

                if (error) throw error;
                if (data) {
                    const mappedData = data.map(item => ({
                        ...item,
                        isoDate: item.isodate
                    }));
                    setExpenses(mappedData);
                }
            } catch (e) {
                console.error("Failed to load expenses from Supabase", e);
            } finally {
                setIsLoading(false);
            }
        }

        loadData();

        // Realtime Subscription
        const expensesSubscription = supabase
            .channel('public:expenses')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'expenses' },
                (payload) => {
                    // When a change happens in the database, refresh the whole list
                    // For a perfectly optimized app we'd mutate state directly based on 'INSERT', 'UPDATE', 'DELETE'
                    // but refetching is safest and easiest for this scale.
                    // Doing state mutation to avoid extra reads:
                    if (payload.eventType === 'INSERT') {
                        const newExp = { ...payload.new, isoDate: payload.new.isodate };
                        setExpenses(prev => {
                            const updated = [newExp, ...prev];
                            return updated.sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));
                        });
                    } else if (payload.eventType === 'DELETE') {
                        setExpenses(prev => prev.filter(exp => exp.id !== payload.old.id));
                    } else if (payload.eventType === 'UPDATE') {
                        const updatedExp = { ...payload.new, isoDate: payload.new.isodate };
                        setExpenses(prev => {
                            const updated = prev.map(exp => exp.id === updatedExp.id ? updatedExp : exp);
                            return updated.sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));
                        });
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(expensesSubscription);
        };
    }, []);

    // Handle Theme Toggle
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('sobrados-theme', theme);
    }, [theme]);

    const handleAddExpense = async (e) => {
        e.preventDefault()
        if (!desc || !amount || !date) return

        // Accept comma or dot for decimal
        const parsedAmount = parseFloat(amount.replace(',', '.'));
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return;
        }

        // Convert ISODate to PT-BR format for display
        const [year, month, day] = date.split('-');
        const formattedDate = `${day}/${month}/${year}`;

        // Upload receipts to Supabase Storage if any
        let newReceiptsArray = [];
        if (receiptFiles && receiptFiles.length > 0) {
            for (const file of receiptFiles) {
                if (file.size > 10 * 1024 * 1024) continue; // Skip files > 10MB

                try {
                    const fileExt = file.name.split('.').pop();
                    const fileName = `${uuidv4()}.${fileExt}`;
                    const filePath = `${fileName}`; // Saving to root of 'receipts' bucket

                    const { error: uploadError } = await supabase.storage
                        .from('receipts')
                        .upload(filePath, file);

                    if (uploadError) {
                        console.error('Error uploading file:', uploadError);
                        continue;
                    }

                    // Get public URL
                    const { data: { publicUrl } } = supabase.storage
                        .from('receipts')
                        .getPublicUrl(filePath);

                    newReceiptsArray.push(publicUrl);
                } catch (err) {
                    console.error("Failed to convert one of the receipts", err);
                }
            }
        }

        const newExp = {
            date: formattedDate,
            isodate: date,
            description: desc,
            category,
            amount: parsedAmount,
            payer,
            status,
            receipts: newReceiptsArray
        }

        // Send to Supabase
        const { error } = await supabase
            .from('expenses')
            .insert([newExp]);

        if (error) {
            console.error("Error inserting expense:", error);
            alert("Erro ao salvar despesa. Tente novamente.");
        } else {
            // Go back to the first page when adding a new expense
            setCurrentPage(1);

            // Reset form
            setDesc('')
            setAmount('')
            setReceiptFiles([])
            // Keep category and payer as they were to speed up data entry
        }
    }

    const handleEditClick = (exp) => {
        setEditingId(exp.id);
        setEditFormData({
            date: exp.isoDate,
            description: exp.description,
            amount: exp.amount.toString().replace('.', ','),
            payer: exp.payer,
            category: exp.category,
            status: exp.status || 'Pago'
        });
    }

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditFormData({});
    }

    const handleSaveEdit = async (id) => {
        const parsedAmount = parseFloat(editFormData.amount.replace(',', '.'));
        if (isNaN(parsedAmount) || parsedAmount <= 0 || !editFormData.description || !editFormData.date) {
            alert("Preencha todos os campos corretamente.");
            return;
        }

        const [year, month, day] = editFormData.date.split('-');
        const formattedDate = `${day}/${month}/${year}`;

        const updateData = {
            isodate: editFormData.date,
            date: formattedDate,
            description: editFormData.description,
            amount: parsedAmount,
            payer: editFormData.payer,
            category: editFormData.category,
            status: editFormData.status
        };

        const { error } = await supabase
            .from('expenses')
            .update(updateData)
            .eq('id', id);

        if (error) {
            console.error("Error updating:", error);
            alert("Erro ao atualizar!");
            return;
        }

        setEditingId(null);
        setEditFormData({});
    }

    const handleMarkAsPaid = async (id) => {
        const { error } = await supabase.from('expenses').update({ status: 'Pago' }).eq('id', id);
        if (error) console.error("Error marking as paid:", error);
    }

    const handleAttachReceipt = async (id, files) => {
        if (!files || files.length === 0) return;

        const exp = expenses.find(e => e.id === id);
        if (!exp) return;

        setUploadingId(id);

        let newReceipts = [];
        for (const file of Array.from(files)) {
            if (file.size > 10 * 1024 * 1024) {
                alert(`A imagem ${file.name} é maior que 10MB e não pôde ser enviada.`);
                continue;
            }
            try {
                const fileExt = file.name.split('.').pop();
                const fileName = `${uuidv4()}.${fileExt}`;
                const filePath = `${fileName}`;

                const { error: uploadError } = await supabase.storage
                    .from('receipts')
                    .upload(filePath, file);

                if (uploadError) {
                    console.error("Supabase Storage Error:", uploadError);
                    alert("Erro ao enviar imagem: " + uploadError.message);
                    continue;
                }

                const { data: { publicUrl } } = supabase.storage
                    .from('receipts')
                    .getPublicUrl(filePath);

                newReceipts.push(publicUrl);
            } catch (err) {
                console.error("Failed to upload receipt", err);
            }
        }

        if (newReceipts.length > 0) {
            const currentReceipts = exp.receipts || (exp.receipt ? [exp.receipt] : []);
            const updatedReceipts = [...currentReceipts, ...newReceipts];

            const { error } = await supabase
                .from('expenses')
                .update({ receipts: updatedReceipts })
                .eq('id', id);

            if (error) {
                console.error("Error updating receipts:", error);
                alert("Erro ao salvar o comprovante no gasto: " + error.message);
            }
        }

        setUploadingId(null);
    }

    const deleteFilesFromStorage = async (urls) => {
        if (!urls || urls.length === 0) return;
        const fileNames = urls.map(url => {
            try { return url.split('/').pop().split('?')[0]; }
            catch { return url; }
        }).filter(Boolean);

        if (fileNames.length > 0) {
            const { error } = await supabase.storage.from('receipts').remove(fileNames);
            if (error) console.error("Error deleting from storage:", error);
        }
    }

    const handleDeleteReceipt = async (id, indexToRemove) => {
        if (confirm("Tem certeza que deseja remover este comprovante?")) {
            const exp = expenses.find(e => e.id === id);
            if (!exp) return;

            const currentReceipts = exp.receipts || (exp.receipt ? [exp.receipt] : []);
            const urlToRemove = currentReceipts[indexToRemove];

            // Delete actual file from Supabase Storage Bucket
            await deleteFilesFromStorage([urlToRemove]);

            const newReceipts = currentReceipts.filter((_, idx) => idx !== indexToRemove);

            const { error } = await supabase
                .from('expenses')
                .update({ receipts: newReceipts })
                .eq('id', id);

            if (error) {
                console.error("Error deleting receipt:", error);
                return;
            }

            // Update modal state instantly if open
            if (newReceipts.length > 0) {
                setViewReceipt({ ...exp, receipts: newReceipts });
            } else {
                setViewReceipt(null);
            }
        }
    }

    const handleDelete = async (id) => {
        if (confirm("Tem certeza que deseja apagar este lançamento?")) {
            const expToDelete = expenses.find(e => e.id === id);

            // Delete associated files from storage first
            if (expToDelete) {
                const allReceipts = expToDelete.receipts || (expToDelete.receipt ? [expToDelete.receipt] : []);
                if (allReceipts.length > 0) {
                    await deleteFilesFromStorage(allReceipts);
                }
            }

            const { error } = await supabase.from('expenses').delete().eq('id', id);

            if (error) {
                console.error("Error deleting:", error);
                alert("Erro ao excluir!");
                return;
            }

            // Handle edge case where deleting the last item on a page leaves it empty
            // The realtime listener will update the list, but we manually fix pagination logic
            const totalPagesAfterDelete = Math.ceil((filteredExpenses.length - 1) / ITEMS_PER_PAGE);
            if (currentPage > totalPagesAfterDelete && totalPagesAfterDelete > 0) {
                setCurrentPage(totalPagesAfterDelete);
            }
        }
    }



    const handleExportPDF = () => {
        const element = document.getElementById('settlement-report-content');
        if (!element) return;

        // Use a classe clone temporária para garantir que conteúdo com scroll interno (se existir)
        // ou estilos escondidos vazem pro PDF. Em muitos casos de modal, a altura limitada corta o PDF.
        const opt = {
            margin: [0.5, 0.5, 0.5, 0.5], // [top, left, bottom, right]
            filename: 'acerto-sobrados-finance.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                scrollY: 0 // Evita que corte se a página estiver rolada
            },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
        };

        window.html2pdf().set(opt).from(element).save();
    };

    // Calculations
    const { total, totalVinicius, totalLuiz, totalAmbos, categoryTotals } = useMemo(() => {
        const result = { total: 0, totalVinicius: 0, totalLuiz: 0, totalAmbos: 0, categoryTotals: {} };

        CATEGORIES.forEach(cat => result.categoryTotals[cat] = 0);

        expenses.forEach(curr => {
            // If it's not paid yet, it doesn't enter the financial balance or category totals
            if (curr.status === 'A Pagar') return;

            // Is this a transfer/settlement?
            if (curr.category === 'Transferência/Acerto') {
                if (curr.payer === 'Vinícius') {
                    // Vinícius transferring to Luiz -> Increases Vinícius contribution, decreases Luiz's
                    result.totalVinicius += curr.amount;
                    result.totalLuiz -= curr.amount;
                } else if (curr.payer === 'Luiz') {
                    // Luiz transferring to Vinícius -> Increases Luiz's contribution, decreases Vinícius's
                    result.totalLuiz += curr.amount;
                    result.totalVinicius -= curr.amount;
                }
            } else {
                // Normal Expenses
                // Só contabiliza no balance dashboard se estiver dentro do filtro de mês
                const expMonth = curr.isoDate.substring(0, 7);
                if (filterMonth === '' || expMonth === filterMonth) {
                    result.total += curr.amount;
                    if (curr.payer === 'Vinícius') result.totalVinicius += curr.amount;
                    else if (curr.payer === 'Luiz') result.totalLuiz += curr.amount;
                    else if (curr.payer === 'Ambos') result.totalAmbos += curr.amount;
                }
            }

            // Ensure category exists in the totals object
            if (result.categoryTotals[curr.category] !== undefined) {
                result.categoryTotals[curr.category] += curr.amount;
            } else {
                result.categoryTotals[curr.category] = curr.amount;
            }
        });

        return result;
    }, [expenses, filterMonth])

    // Settlement Logic
    // Total of the project that needed to be divided
    // 'Ambos' means they already split it and paid together, so it doesn't affect the debt balance.
    // The debt is calculated only on what was paid individually.
    const individualTotal = totalVinicius + totalLuiz;
    const perPersonDebtTarget = individualTotal / 2;

    let settlementMsg = "Tudo certo! Ninguém deve nada."
    let settlementClass = "neutral"

    if (totalVinicius > totalLuiz) {
        const owes = totalVinicius - perPersonDebtTarget;
        if (owes > 0) {
            settlementMsg = `Luiz deve ${formatCurrency(owes)} para Vinícius`
            settlementClass = "active"
        }
    } else if (totalLuiz > totalVinicius) {
        const owes = totalLuiz - perPersonDebtTarget;
        if (owes > 0) {
            settlementMsg = `Vinícius deve ${formatCurrency(owes)} para Luiz`
            settlementClass = "active"
        }
    }

    // Generate Itemized Debt Breakdown
    const debtBreakdown = useMemo(() => {
        if (settlementClass === 'neutral') return [];

        // Determine who is the creditor and who is the debtor
        const isViniciusDebtor = totalLuiz > totalVinicius;
        const creditor = isViniciusDebtor ? 'Luiz' : 'Vinícius';
        const debtor = isViniciusDebtor ? 'Vinícius' : 'Luiz';

        const breakdownItems = [];

        // Sort expenses chronologically
        const sortedExpenses = [...expenses].sort((a, b) => new Date(a.isoDate) - new Date(b.isoDate));

        sortedExpenses.forEach(exp => {
            if (exp.status === 'A Pagar') return;

            // Importante: O Acerto Itemizado também precisa respeitar o filtro de Mês, 
            // ou se nenhum mês estiver filtrado, pega tudo.
            const expMonth = exp.isoDate.substring(0, 7);
            if (filterMonth !== '' && expMonth !== filterMonth) return;

            if (exp.category === 'Transferência/Acerto') {
                if (exp.payer === debtor) {
                    breakdownItems.push({
                        id: exp.id,
                        date: exp.date,
                        desc: `Acerto transferido por ${debtor}`,
                        amount: exp.amount,
                        type: 'payment', // Reduced debt
                    });
                }
                else if (exp.payer === creditor) {
                    breakdownItems.push({
                        id: exp.id,
                        date: exp.date,
                        desc: `Acerto transferido por ${creditor}`,
                        amount: exp.amount,
                        type: 'debt', // Increased debt
                    });
                }
            } else {
                if (exp.payer === creditor) {
                    breakdownItems.push({
                        id: exp.id,
                        date: exp.date,
                        desc: exp.description,
                        category: exp.category,
                        fullAmount: exp.amount,
                        amount: exp.amount / 2,
                        type: 'debt', // Credor pagou a conta = aumenta a conta do devedor (+)
                        payer: exp.payer,
                    });
                } else if (exp.payer === debtor) {
                    breakdownItems.push({
                        id: exp.id,
                        date: exp.date,
                        desc: exp.description,
                        category: exp.category,
                        fullAmount: exp.amount,
                        amount: exp.amount / 2,
                        type: 'payment', // Devedor pagou a conta = abate da conta que ele deve (-)
                        payer: exp.payer,
                    });
                }
            }
        });

        return { creditor, debtor, items: breakdownItems.reverse() /* show newest first */ };
    }, [expenses, settlementClass, totalVinicius, totalLuiz, filterMonth]);

    function formatCurrency(val) {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)
    }

    // Filtering Logic
    const filteredExpenses = expenses.filter(exp => {
        const matchesSearch = exp.description.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = filterCategory === '' || exp.category === filterCategory;
        const expStatus = exp.status || 'Pago';
        const matchesStatus = filterStatus === '' || expStatus === filterStatus;
        const expMonth = exp.isoDate.substring(0, 7);
        const matchesMonth = filterMonth === '' || expMonth === filterMonth;

        return matchesSearch && matchesCategory && matchesStatus && matchesMonth;
    });

    // Pagination Logic
    const totalPages = Math.ceil(filteredExpenses.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const paginatedExpenses = filteredExpenses.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    const handleExportCSV = async () => {
        const escapeCSV = (str) => {
            if (str === null || str === undefined) return '""';
            const s = String(str);
            return `"${s.replace(/"/g, '""')}"`;
        };

        const headers = ["Data", "Descrição", "Categoria", "Status", "Pagador", "Valor (R$)"];
        
        let csvBody = expenses.map(exp => {
            return [
                escapeCSV(exp.date),
                escapeCSV(exp.description),
                escapeCSV(exp.category),
                escapeCSV(exp.status || 'Pago'),
                escapeCSV(exp.payer),
                escapeCSV(exp.amount.toString().replace('.', ','))
            ].join(",");
        }).join("\n");

        // Format summaries
        const summaryText = [
            "", 
            escapeCSV("RESUMO FINANCEIRO") + ",,,,,",
            `${escapeCSV("Gasto Total da Obra:")},${escapeCSV(formatCurrency(total))},,,,`,
            `${escapeCSV("Vinícius Pagou:")},${escapeCSV(formatCurrency(totalVinicius))},,,,`,
            `${escapeCSV("Luiz Pagou:")},${escapeCSV(formatCurrency(totalLuiz))},,,,`,
            `${escapeCSV("Pagos Juntos (Ambos):")},${escapeCSV(formatCurrency(totalAmbos))},,,,`,
            "", 
            escapeCSV("SITUAÇÃO DO ACERTO") + ",,,,,",
            `${escapeCSV(settlementMsg)},,,,,`
        ].join("\n");

        const csvContent = headers.map(escapeCSV).join(",") + "\n" + csvBody + "\n" + summaryText;

        // \uFEFF is the BOM for UTF-8 so Excel opens it with correct accents
        // Removed trailing semicolon from type, as it can cause issues on Android
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8' });
        const fileName = 'sobrados_gastos_completo.csv';

        // Faz o download direto sempre
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    };

    if (isLoading) {
        return (
            <div className="app-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', textAlign: 'center' }}>
                <style>{`
                    @keyframes spin { 100% { transform: rotate(360deg); } }
                    .spin-animation { animation: spin 1s linear infinite; }
                `}</style>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spin-animation" style={{ marginBottom: '16px' }}>
                    <line x1="12" y1="2" x2="12" y2="6"></line>
                    <line x1="12" y1="18" x2="12" y2="22"></line>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                    <line x1="2" y1="12" x2="6" y2="12"></line>
                    <line x1="18" y1="12" x2="22" y2="12"></line>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                    <line x1="16.24" y1="4.93" x2="19.07" y2="7.76"></line>
                </svg>
                <h2 style={{ color: 'var(--text)', fontSize: '18px', fontWeight: '500' }}>Buscando dados da obra...</h2>
            </div>
        );
    }

    return (
        <div className="app-container">
            <header className="header">
                <div>
                    <h1 className="header-title">
                        <svg className="title-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 20h20"></path>
                            <path d="M5 20V5l9-3 6 3v15"></path>
                            <path d="M9 20V9h6v11"></path>
                        </svg>
                        Sobrados
                        {isAdmin && <span style={{ fontSize: '12px', color: 'var(--primary)', marginLeft: '8px' }}>(Modo Edição)</span>}
                    </h1>
                    <p className="header-subtitle">Controle de Custos da Obra</p>
                </div>
            </header>

            {/* FORM: Registrar Novo Gasto - Moved to Top - Only shown if Admin */}
            {isAdmin && (
                <section className="card">
                    <h2 className="card-title">
                        <svg className="title-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Registrar Novo Gasto
                    </h2>
                    <form onSubmit={handleAddExpense} className="expense-form-grid">
                        <div className="form-group">
                            <label className="form-label">Data</label>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                required
                            />
                        </div>
                        <div className="form-group desc-group">
                            <label className="form-label">Descrição</label>
                            <input
                                type="text"
                                placeholder="Ex: Engenheiro, Cimento, etc."
                                value={desc}
                                onChange={(e) => setDesc(e.target.value)}
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Categoria</label>
                            <select value={category} onChange={(e) => setCategory(e.target.value)}>
                                {CATEGORIES.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Status</label>
                            <select value={status} onChange={(e) => setStatus(e.target.value)}>
                                <option value="Pago">Pago</option>
                                <option value="A Pagar">A Pagar</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Quem Pagou?</label>
                            <select value={payer} onChange={(e) => setPayer(e.target.value)}>
                                <option value="Vinícius">Vinícius</option>
                                <option value="Luiz">Luiz</option>
                                <option value="Ambos">Ambos</option>
                            </select>
                        </div>
                        <div className="form-group width-auto">
                            <label className="form-label">Valor (R$)</label>
                            <input
                                type="text"
                                placeholder="0,00"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                required
                            />
                        </div>
                        <div className="form-group" style={{ gridColumn: 'span 12' }}>
                            <label className="form-label">Recibo / Comprovante (Opcional)</label>
                            <input
                                type="file"
                                multiple
                                accept="image/*,application/pdf"
                                onChange={(e) => setReceiptFiles(Array.from(e.target.files))}
                                key={receiptFiles.length ? receiptFiles[0].name : 'empty'}
                                className="file-input"
                            />
                            {receiptFiles.length > 0 && <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)' }}>{receiptFiles.length} arquivo(s) selecionado(s)</small>}
                        </div>
                        <div className="form-group submit-group">
                            <button type="submit" className="btn-primary">Adicionar Lançamento</button>
                        </div>
                    </form>
                </section>
            )}

            {/* BALANCE DASHBOARD */}
            <section className="card">
                <h2 className="card-title">
                    <svg className="title-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="1" x2="12" y2="23"></line>
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                    Resumo Financeiro
                </h2>

                <div className="balance-grid">
                    <div className="balance-item highlight">
                        <div className="balance-label">Gasto Total da Obra</div>
                        <div className="balance-value">{formatCurrency(total)}</div>
                    </div>
                    <div className="balance-item">
                        <div className="balance-label">Vinícius Pagou (Individual)</div>
                        <div className="balance-value" style={{ color: '#60a5fa' }}>{formatCurrency(totalVinicius)}</div>
                    </div>
                    <div className="balance-item">
                        <div className="balance-label">Luiz Pagou (Individual)</div>
                        <div className="balance-value" style={{ color: '#34d399' }}>{formatCurrency(totalLuiz)}</div>
                    </div>
                    <div className="balance-item">
                        <div className="balance-label">Pagos Juntos (Ambos)</div>
                        <div className="balance-value" style={{ color: '#fbbf24' }}>{formatCurrency(totalAmbos)}</div>
                    </div>
                </div>

                <div className={`settlement-alert ${settlementClass}`}>
                    {settlementClass === 'active' && (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                    )}
                    {settlementClass === 'neutral' && (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    )}
                    <span>{settlementMsg}</span>
                    {settlementClass === 'active' && (
                        <button
                            className="btn-details-link"
                            onClick={() => setViewSettlementDetails(true)}
                        >
                            Ver Detalhes
                        </button>
                    )}
                </div>
            </section>

            {/* TABLE */}
            <section className="card">
                <h2 className="card-title">
                    <svg className="title-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="8" y1="6" x2="21" y2="6"></line>
                        <line x1="8" y1="12" x2="21" y2="12"></line>
                        <line x1="8" y1="18" x2="21" y2="18"></line>
                        <line x1="3" y1="6" x2="3.01" y2="6"></line>
                        <line x1="3" y1="12" x2="3.01" y2="12"></line>
                        <line x1="3" y1="18" x2="3.01" y2="18"></line>
                    </svg>
                    Tabela de Lançamentos
                    <span className="count-badge">{filteredExpenses.length}</span>
                </h2>

                <div className="filters-bar">
                    <input
                        type="text"
                        placeholder="Buscar por descrição..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="filter-search"
                    />
                    <select
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value)}
                        className="filter-select"
                    >
                        <option value="">Períodos</option>
                        {availableMonths.map(monthStr => {
                            const [y, m] = monthStr.split('-');
                            return <option key={monthStr} value={monthStr}>{`${m}/${y}`}</option>;
                        })}
                    </select>
                    <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="filter-select"
                    >
                        <option value="">Categorias</option>
                        {CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>

                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="filter-select"
                    >
                        <option value="">Status</option>
                        <option value="Pago">Pago</option>
                        <option value="A Pagar">A Pagar</option>
                    </select>

                    <button onClick={handleExportCSV} className="btn-export" title="Baixar relatório em Excel / CSV">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        <span className="export-label">Exportar Planilha</span>
                    </button>
                </div>

                {filteredExpenses.length === 0 ? (
                    <div className="empty-state">
                        Nenhuma despesa encontrada para os filtros aplicados.
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="expenses-table">
                            <thead>
                                <tr>
                                    <th>Data</th>
                                    <th>Descrição</th>
                                    <th>Categoria</th>
                                    <th>Status</th>
                                    <th>Pagador</th>
                                    <th className="text-right">Valor</th>
                                    <th className="text-center">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedExpenses.map(exp => {
                                    const isEditing = editingId === exp.id;
                                    return (
                                        <tr key={exp.id}>
                                            <td className="td-date">
                                                {isEditing ? (
                                                    <input
                                                        type="date"
                                                        value={editFormData.date}
                                                        onChange={(e) => setEditFormData({ ...editFormData, date: e.target.value })}
                                                        className="edit-input"
                                                    />
                                                ) : exp.date}
                                            </td>
                                            <td className="td-desc">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={editFormData.description}
                                                        onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                                                        className="edit-input"
                                                    />
                                                ) : exp.description}
                                            </td>
                                            <td>
                                                {isEditing ? (
                                                    <select
                                                        value={editFormData.category}
                                                        onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value })}
                                                        className="edit-input"
                                                    >
                                                        {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                                    </select>
                                                ) : (
                                                    <span className="category-badge">{exp.category}</span>
                                                )}
                                            </td>
                                            <td>
                                                {isEditing ? (
                                                    <select
                                                        value={editFormData.status}
                                                        onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                                                        className="edit-input"
                                                    >
                                                        <option value="Pago">Pago</option>
                                                        <option value="A Pagar">A Pagar</option>
                                                    </select>
                                                ) : (
                                                    <span className={`status-badge ${exp.status === 'A Pagar' ? 'status-pendente' : 'status-pago'}`}>
                                                        {exp.status || 'Pago'}
                                                    </span>
                                                )}
                                            </td>
                                            <td>
                                                {isEditing ? (
                                                    <select
                                                        value={editFormData.payer}
                                                        onChange={(e) => setEditFormData({ ...editFormData, payer: e.target.value })}
                                                        className="edit-input"
                                                    >
                                                        <option value="Vinícius">Vinícius</option>
                                                        <option value="Luiz">Luiz</option>
                                                        <option value="Ambos">Ambos</option>
                                                    </select>
                                                ) : (
                                                    <span className={`payer-badge ${exp.payer.toLowerCase().replace('í', 'i')}`}>
                                                        {exp.payer}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="td-amount text-right">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={editFormData.amount}
                                                        onChange={(e) => setEditFormData({ ...editFormData, amount: e.target.value })}
                                                        className="edit-input text-right"
                                                        style={{ width: '90px' }}
                                                    />
                                                ) : formatCurrency(exp.amount)}
                                            </td>
                                            <td className="td-actions text-center">
                                                <div className="actions-flex">
                                                    {isEditing ? (
                                                        <>
                                                            <button onClick={() => handleSaveEdit(exp.id)} className="btn-success" title="Salvar">
                                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                                            </button>
                                                            <button onClick={handleCancelEdit} className="btn-danger" title="Cancelar">
                                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            {(exp.receipts && exp.receipts.length > 0) || exp.receipt ? (
                                                                <button
                                                                    onClick={() => setViewReceipt(exp)}
                                                                    className="btn-info"
                                                                    title="Ver Comprovantes"
                                                                >
                                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                                                    </svg>
                                                                </button>
                                                            ) : (
                                                                <label className="btn-upload" title="Anexar Comprovante">
                                                                    <input
                                                                        type="file"
                                                                        multiple
                                                                        accept="image/*,application/pdf"
                                                                        style={{ display: 'none' }}
                                                                        onChange={(e) => handleAttachReceipt(exp.id, e.target.files)}
                                                                        disabled={uploadingId === exp.id}
                                                                    />
                                                                    {uploadingId === exp.id ? (
                                                                        <span style={{ fontSize: '11px', fontWeight: 'bold' }}>...</span>
                                                                    ) : (
                                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                                                            <polyline points="17 8 12 3 7 8"></polyline>
                                                                            <line x1="12" y1="3" x2="12" y2="15"></line>
                                                                        </svg>
                                                                    )}
                                                                </label>
                                                            )}
                                                            {isAdmin && exp.status === 'A Pagar' && (
                                                                <button
                                                                    onClick={() => handleMarkAsPaid(exp.id)}
                                                                    className="btn-success"
                                                                    title="Marcar como Pago"
                                                                >
                                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                        <polyline points="20 6 9 17 4 12"></polyline>
                                                                    </svg>
                                                                </button>
                                                            )}
                                                            {isAdmin && (
                                                                <>
                                                                    <button
                                                                        onClick={() => handleEditClick(exp)}
                                                                        className="btn-edit"
                                                                        title="Editar Despesa"
                                                                    >
                                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                                                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                                                        </svg>
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDelete(exp.id)}
                                                                        className="btn-danger"
                                                                        title="Remover Despesa"
                                                                    >
                                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                            <polyline points="3 6 5 6 21 6"></polyline>
                                                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                                        </svg>
                                                                    </button>
                                                                </>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                            <div className="pagination-container">
                                <button
                                    className="btn-pagination"
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(prev => prev - 1)}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="15 18 9 12 15 6"></polyline>
                                    </svg>
                                    Anterior
                                </button>

                                <span className="pagination-info">
                                    Página {currentPage} de {totalPages}
                                </span>

                                <button
                                    className="btn-pagination"
                                    disabled={currentPage === totalPages}
                                    onClick={() => setCurrentPage(prev => prev + 1)}
                                >
                                    Próxima
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="9 18 15 12 9 6"></polyline>
                                    </svg>
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* DESPESAS POR CATEGORIA - Moved to Bottom */}
            {total > 0 && (
                <section className="card">
                    <h2 className="card-title">
                        <svg className="title-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
                            <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
                        </svg>
                        Gastos por Categoria
                    </h2>
                    <div className="category-grid">
                        {Object.entries(categoryTotals)
                            .filter(([, amount]) => amount > 0)
                            .sort((a, b) => b[1] - a[1]) // Sort highest first
                            .map(([cat, amount]) => (
                                <div key={cat} className="category-item">
                                    <div className="category-name">{cat}</div>
                                    <div className="category-amount">{formatCurrency(amount)}</div>
                                    <div className="category-progress-bar">
                                        <div
                                            className="category-progress-fill"
                                            style={{ width: `${(amount / total) * 100}%` }}
                                        ></div>
                                    </div>
                                </div>
                            ))}
                    </div>
                </section>
            )}
            {/* ITEM-BY-ITEM SETTLEMENT DETAILS MODAL */}
            {viewSettlementDetails && (
                <div className="receipt-modal-overlay" onClick={() => setViewSettlementDetails(false)}>
                    <div className="receipt-modal-content settlement-details-modal" onClick={e => e.stopPropagation()}>
                        <div className="receipt-modal-header">
                            <h3>Extrato de Acertos</h3>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button onClick={handleExportPDF} title="Exportar para PDF" style={{
                                    height: '36px', padding: '0 1rem', fontSize: '0.8rem', fontWeight: 700,
                                    background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                                    borderRadius: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                                    gap: '6px', transition: 'all 0.2s ease', letterSpacing: '0.03em'
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.borderColor = '#f87171'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.borderColor = '#fecaca'; }}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="7 10 12 15 17 10"></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                    </svg>
                                    PDF
                                </button>
                                <button className="btn-close" onClick={() => setViewSettlementDetails(false)}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>
                        </div>
                        <div className="receipt-modal-body debt-modal-body" id="settlement-report-content" style={{ maxHeight: 'none', overflow: 'visible' }}>

                            <div className="debt-conclusion" style={{ marginBottom: '1rem' }}>
                                <strong>Saldo Atual:</strong>
                                <p>{settlementMsg}</p>
                            </div>

                            {settlementClass === 'active' && debtBreakdown && (
                                <div className="debt-breakdown-list">
                                    <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        Entenda de onde vem essa dívida:
                                    </h4>

                                    <div className="breakdown-items-container">
                                        {debtBreakdown.items.map(item => (
                                            <div key={item.id} className={`breakdown-item ${item.type}`}>
                                                <div className="b-item-left">
                                                    <span className="b-item-date">{item.date}</span>
                                                    <span className="b-item-desc">{item.desc}</span>
                                                    {item.category && (
                                                        <span className="b-item-sub">
                                                            {item.payer} pagou {formatCurrency(item.fullAmount)} ({item.category})
                                                        </span>
                                                    )}
                                                </div>
                                                <div className={`b-item-right ${item.type === 'debt' ? 'text-danger' : 'text-success'}`}>
                                                    {item.type === 'debt' ? '+' : '-'} {formatCurrency(item.amount)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {settlementClass === 'neutral' && (
                                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                                    A conta está perfeita. Ninguém precisa transferir nada.
                                </div>
                            )}

                        </div>
                    </div>
                </div>
            )}

            {/* MULTIPLE RECEIPTS MODAL */}
            {viewReceipt && (() => {
                const currentViewReceipt = expenses.find(e => e.id === viewReceipt.id) || viewReceipt;
                return (
                    <div className="receipt-modal-overlay" onClick={() => setViewReceipt(null)}>
                        <div className="receipt-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', width: '90%' }}>
                            <div className="receipt-modal-header">
                                <h3>Comprovantes ({currentViewReceipt.receipts?.length || 1})</h3>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    {isAdmin && (
                                        <label className="btn-success" title="Adicionar mais um" style={{ width: '32px', height: '32px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '8px' }}>
                                            <input
                                                type="file"
                                                multiple
                                                accept="image/*,application/pdf"
                                                style={{ display: 'none' }}
                                                onChange={async (e) => {
                                                    await handleAttachReceipt(currentViewReceipt.id, e.target.files);
                                                    e.target.value = null;
                                                }}
                                                disabled={uploadingId === currentViewReceipt.id}
                                            />
                                            {uploadingId === currentViewReceipt.id ? (
                                                <span style={{ fontSize: '11px', fontWeight: 'bold' }}>...</span>
                                            ) : (
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                            )}
                                        </label>
                                    )}
                                    <button className="btn-close" onClick={() => setViewReceipt(null)}>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                    </button>
                                </div>
                            </div>
                            <div className="receipt-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxHeight: '70vh', overflowY: 'auto' }}>
                                {(currentViewReceipt.receipts || (currentViewReceipt.receipt ? [currentViewReceipt.receipt] : [])).map((urlOrB64, index) => (
                                    <div key={index} style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.5rem', background: 'var(--background)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', alignItems: 'center', padding: '0 0.5rem' }}>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Anexo {index + 1}</span>
                                            {isAdmin && (
                                                <button
                                                    className="btn-danger"
                                                    onClick={() => handleDeleteReceipt(currentViewReceipt.id, index)}
                                                    title="Apagar Comprovante"
                                                    style={{ width: '28px', height: '28px', padding: 0 }}
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="3 6 5 6 21 6"></polyline>
                                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                    </svg>
                                                </button>
                                            )}
                                        </div>

                                        {(urlOrB64 && (urlOrB64.includes('.pdf') || urlOrB64.startsWith('data:application/pdf'))) ? (
                                            <iframe src={urlOrB64} title={`Recibo PDF ${index}`} width="100%" height="300px" style={{ border: 'none', borderRadius: '8px' }}></iframe>
                                        ) : (
                                            <img src={urlOrB64} alt={`Recibo ${index}`} style={{ width: '100%', height: 'auto', borderRadius: '8px', display: 'block' }} />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* CADEADO ESCONDIDO NO RODAPÉ */}
            <div style={{ textAlign: 'center', padding: '10px 0', marginTop: '0' }}>
                <button
                    onClick={() => {
                        if (isAdmin) {
                            setIsAdmin(false);
                        } else {
                            const pwd = prompt("Senha:");
                            if (pwd === "sobrados123") {
                                setIsAdmin(true);
                            } else if (pwd !== null) {
                                alert("Senha incorreta");
                            }
                        }
                    }}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: isAdmin ? 'var(--primary)' : 'var(--text-muted)',
                        opacity: isAdmin ? 0.8 : 0.2, // Quase invisível quando não admin
                        padding: '10px',
                        transition: 'opacity 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = isAdmin ? '0.8' : '0.2'}
                    title="Acesso Restrito"
                >
                    {isAdmin ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
                        </svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                    )}
                </button>
            </div>
        </div>
    )
}

export default App
