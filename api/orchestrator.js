// api/orchestrator.js

export default async function handler(req, res) {
    // 1. Pastikan hanya menerima request POST dari frontend
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Hanya menerima method POST' });
    }

    try {
        // 2. Mengambil data dari frontend
        // frontend akan mengirimkan prompt, tingkat kerumitan (loop), dan gambar (base64 jika ada)
        const { prompt, complexity = 1, images = [] } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt tidak boleh kosong' });
        }

        // Mengambil API Key dari Environment Variables Vercel
        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

        // ==========================================
        // FASE 1 & 2: DRAFTING (Berjalan Paralel)
        // ==========================================
        
        // Kita memanggil Groq dan OpenRouter secara bersamaan untuk menghemat waktu
        const [draftGroq, draftOpenRouter] = await Promise.all([
            callOpenAICompatibleAPI(
                "https://api.groq.com/openai/v1/chat/completions",
                GROQ_API_KEY,
                "llama-3.1-70b-versatile",
                "Kamu adalah AI Analis A. Berikan analisis awal yang tajam terhadap instruksi user.",
                prompt
            ),
            callOpenAICompatibleAPI(
                "https://openrouter.ai/api/v1/chat/completions",
                OPENROUTER_API_KEY,
                "google/gemma-2-9b-it:free",
                "Kamu adalah AI Analis B. Berikan perspektif alternatif dan detail terhadap instruksi user.",
                prompt
            )
        ]);

        let currentDraftA = draftGroq;
        let currentDraftB = draftOpenRouter;
        let debateHistory = `[Draft Awal Groq]:\n${currentDraftA}\n\n[Draft Awal OpenRouter]:\n${currentDraftB}\n\n`;

        // ==========================================
        // FASE 3: EVALUASI SILANG (DEBATING)
        // ==========================================
        
        // Looping dinamis berdasarkan tingkat kerumitan (1 sampai 3 putaran)
        for (let i = 1; i <= complexity; i++) {
            const [kritikUntukA, kritikUntukB] = await Promise.all([
                callOpenAICompatibleAPI(
                    "https://api.groq.com/openai/v1/chat/completions",
                    GROQ_API_KEY,
                    "llama-3.1-70b-versatile",
                    "Kamu adalah AI A. Baca draf dari AI B berikut, cari kelemahannya, dan berikan argumen balasan yang lebih baik.",
                    `Instruksi asli: ${prompt}\n\nDraf AI B: ${currentDraftB}`
                ),
                callOpenAICompatibleAPI(
                    "https://openrouter.ai/api/v1/chat/completions",
                    OPENROUTER_API_KEY,
                    "google/gemma-2-9b-it:free",
                    "Kamu adalah AI B. Baca draf dari AI A berikut, perbaiki data yang salah, dan berikan bantahan yang logis.",
                    `Instruksi asli: ${prompt}\n\nDraf AI A: ${currentDraftA}`
                )
            ]);

            currentDraftA = kritikUntukA;
            currentDraftB = kritikUntukB;
            debateHistory += `[Putaran ${i} - Bantahan Groq]:\n${currentDraftA}\n\n[Putaran ${i} - Bantahan OpenRouter]:\n${currentDraftB}\n\n`;
        }

        // ==========================================
        // FASE 4: SINTESIS (HAKIM GEMINI 1.5 PRO)
        // ==========================================
        
        const finalSynthesis = await callGeminiAPI(
            GEMINI_API_KEY, 
            prompt, 
            debateHistory, 
            images // Mengirim gambar jika ada
        );

        // 3. Mengembalikan hasil final dan riwayat debat ke frontend
        return res.status(200).json({
            finalOutput: finalSynthesis,
            debateHistory: debateHistory
        });

    } catch (error) {
        console.error("Error di Orchestrator:", error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server AI', details: error.message });
    }
}

// --- FUNGSI BANTUAN (HELPER FUNCTIONS) ---

// Fungsi untuk memanggil API yang formatnya mirip OpenAI (Groq, OpenRouter, dll)
async function callOpenAICompatibleAPI(url, apiKey, model, systemPrompt, userPrompt) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 1000
        })
    });

    if (!response.ok) {
        throw new Error(`Gagal memanggil API: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Fungsi khusus untuk memanggil Gemini API (Karena formatnya berbeda dari OpenAI)
async function callGeminiAPI(apiKey, originalPrompt, debateHistory, images) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;
    
    // Menyusun teks yang akan diberikan ke Gemini
    const fullPrompt = `Kamu adalah Hakim AI tingkat tinggi. 
Instruksi awal dari user adalah: "${originalPrompt}".

Berikut adalah riwayat perdebatan antara beberapa agen AI:
${debateHistory}

Tugasmu: Analisis seluruh argumen di atas, periksa faktanya, gabungkan poin-poin terbaik, dan berikan 1 jawaban final yang paling akurat, terstruktur, dan objektif untuk user.`;

    // Format payload untuk Gemini
    const payload = {
        contents: [{
            parts: [{ text: fullPrompt }]
        }]
    };

    // Jika ada gambar (Base64), tambahkan ke dalam parts Gemini
    if (images && images.length > 0) {
        images.forEach(img => {
            // Asumsi img formatnya adalah "data:image/jpeg;base64,/9j/4AAQSk..."
            const mimeType = img.split(';')[0].split(':')[1];
            const base64Data = img.split(',')[1];
            
            payload.contents[0].parts.push({
                inlineData: {
                    mimeType: mimeType,
                    data: base64Data
                }
            });
        });
    }

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Gagal memanggil Gemini API: ${response.statusText}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}