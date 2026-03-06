// Memaksimalkan waktu eksekusi Vercel agar tidak putus di tengah jalan (maksimal 60 detik untuk versi Hobby/Gratis)
export const maxDuration = 60;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Hanya menerima method POST' });
    }

    try {
        const { prompt, complexity = 1, images = [] } = req.body;

        if (!prompt && images.length === 0) {
            return res.status(400).json({ error: 'Prompt atau gambar tidak boleh kosong' });
        }

        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

        // ==========================================
        // FASE 1 & 2: DRAFTING (Berjalan Paralel)
        // ==========================================
        const [draftGroq, draftOpenRouter] = await Promise.all([
            callOpenAICompatibleAPI(
                "https://api.groq.com/openai/v1/chat/completions",
                GROQ_API_KEY,
                "llama-3.3-70b-versatile", // Model Groq yang stabil
                "Kamu adalah AI Analis A. Berikan analisis awal yang tajam terhadap instruksi user.",
                prompt
            ),
            callOpenAICompatibleAPI(
                "https://openrouter.ai/api/v1/chat/completions",
                OPENROUTER_API_KEY,
                "mistralai/mistral-7b-instruct:free", // Model OpenRouter gratis
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
        for (let i = 1; i <= complexity; i++) {
            const [kritikUntukA, kritikUntukB] = await Promise.all([
                callOpenAICompatibleAPI(
                    "https://api.groq.com/openai/v1/chat/completions",
                    GROQ_API_KEY,
                    "llama-3.3-70b-versatile",
                    "Kamu adalah AI A. Baca draf dari AI B berikut, cari kelemahannya, dan berikan argumen balasan yang lebih baik.",
                    `Instruksi asli: ${prompt}\n\nDraf AI B: ${currentDraftB}`
                ),
                callOpenAICompatibleAPI(
                    "https://openrouter.ai/api/v1/chat/completions",
                    OPENROUTER_API_KEY,
                    "mistralai/mistral-7b-instruct:free",
                    "Kamu adalah AI B. Baca draf dari AI A berikut, perbaiki data yang salah, dan berikan bantahan yang logis.",
                    `Instruksi asli: ${prompt}\n\nDraf AI A: ${currentDraftA}`
                )
            ]);

            currentDraftA = kritikUntukA;
            currentDraftB = kritikUntukB;
            debateHistory += `[Putaran ${i} - Bantahan Groq]:\n${currentDraftA}\n\n[Putaran ${i} - Bantahan OpenRouter]:\n${currentDraftB}\n\n`;
        }

        // ==========================================
        // FASE 4: SINTESIS (HAKIM GEMINI)
        // ==========================================
        const finalSynthesis = await callGeminiAPI(
            GEMINI_API_KEY, 
            prompt, 
            debateHistory, 
            images
        );

        return res.status(200).json({
            finalOutput: finalSynthesis,
            debateHistory: debateHistory
        });

    } catch (error) {
        console.error("Error Utama di Orchestrator:", error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server AI', details: error.message });
    }
}

// --- FUNGSI BANTUAN ---

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
        const errorText = await response.text();
        console.error(`[Error dari API ${model}]:`, errorText);
        throw new Error(`Gagal memanggil model ${model}. Status: ${response.status}. Pesan: ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function callGeminiAPI(apiKey, originalPrompt, debateHistory, images) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;
    
    const fullPrompt = `Kamu adalah Hakim AI tingkat tinggi. 
Instruksi awal dari user adalah: "${originalPrompt}".

Berikut adalah riwayat perdebatan antara beberapa agen AI:
${debateHistory}

Tugasmu: Analisis seluruh argumen di atas, periksa faktanya, gabungkan poin-poin terbaik, dan berikan 1 jawaban final yang paling akurat, terstruktur, dan objektif untuk user.`;

    const payload = {
        contents: [{
            parts: [{ text: fullPrompt }]
        }]
    };

    if (images && images.length > 0) {
        images.forEach(img => {
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
        const errorText = await response.text();
        console.error(`[Error dari API Gemini]:`, errorText);
        throw new Error(`Gagal memanggil Gemini. Status: ${response.status}. Pesan: ${errorText}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}


