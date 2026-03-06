// Konfigurasi Firebase (Ganti dengan data dari Project Settings Firebase kamu)
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Inisialisasi Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Variabel untuk menyimpan data gambar yang diunggah
let attachedFiles = [];

// 1. Menangani Input File (Mengubah Gambar ke Base64)
document.getElementById('fileInput').addEventListener('change', function(e) {
    const files = Array.from(e.target.files);
    
    files.forEach(file => {
        // Saat ini kita fokus ke gambar dulu. PDF butuh penanganan khusus nantinya.
        if (!file.type.startsWith('image/')) {
            alert(`File ${file.name} bukan gambar. Saat ini sistem baru mendukung gambar.`);
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Data = event.target.result;
            
            // Simpan ke array
            attachedFiles.push({
                name: file.name,
                dataUrl: base64Data
            });

            // Tampilkan di UI
            const div = document.createElement('div');
            div.className = 'file-chip';
            div.innerHTML = `<span><i class="fas fa-image"></i> ${file.name}</span>`;
            document.getElementById('filePreview').appendChild(div);
        };
        // Membaca file sebagai Base64
        reader.readAsDataURL(file); 
    });
});

// 2. Fungsi Utama: Menjalankan Proses Super AI
async function mulaiProses() {
    const promptInput = document.getElementById("mainPrompt");
    const prompt = promptInput.value.trim();
    const btnSend = document.getElementById("btnSend");

    if (!prompt && attachedFiles.length === 0) {
        alert("Silakan masukkan prompt atau lampirkan gambar terlebih dahulu.");
        return;
    }

    // Tentukan tingkat kerumitan (1 sampai 3 putaran)
    // Jika prompt panjang atau ada gambar, kita naikkan putarannya
    const complexity = (prompt.length > 300 || attachedFiles.length > 0) ? 2 : 1;
    
    // Siapkan array gambar (hanya mengambil dataUrl/Base64-nya saja)
    const base64Images = attachedFiles.map(file => file.dataUrl);

    // Update UI
    btnSend.disabled = true;
    promptInput.value = "";
    tampilkanPesanUser(prompt, attachedFiles);
    updateMonitor(`Memulai Orkestrasi... (Putaran Debat: ${complexity})`, 10);

    try {
        updateMonitor("Mengirim data ke Backend Vercel... (Ini mungkin memakan waktu 1-2 menit)", 40);

        // 3. Memanggil Endpoint Vercel
        const response = await fetch('/api/orchestrator', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: prompt,
                complexity: complexity,
                images: base64Images
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Gagal menghubungi server AI");
        }

        updateMonitor("Menyusun Jawaban Final...", 80);
        const data = await response.json();

        // 4. Menampilkan Hasil ke UI
        tampilkanPesanBot(data.finalOutput);

        // 5. Menyimpan ke Firebase Firestore
        updateMonitor("Menyimpan ke riwayat Firebase...", 90);
        await db.collection("history").add({
            prompt: prompt,
            finalOutput: data.finalOutput,
            debateHistory: data.debateHistory, // Kita simpan juga riwayat debatnya untuk referensi
            rounds: complexity,
            hasImages: base64Images.length > 0,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        updateMonitor("Proses Selesai!", 100);

        // Bersihkan input setelah selesai
        attachedFiles = [];
        document.getElementById('filePreview').innerHTML = '';

    } catch (err) {
        console.error("Terjadi Kesalahan:", err);
        updateMonitor("Terjadi Kesalahan!", 0);
        tampilkanPesanBot("Maaf, terjadi kesalahan saat memproses permintaanmu: " + err.message);
    } finally {
        btnSend.disabled = false;
        setTimeout(() => updateMonitor("Standby", 0), 3000); // Reset monitor setelah 3 detik
    }
}

// --- FUNGSI BANTUAN UNTUK UI ---

function updateMonitor(text, percent) {
    document.getElementById("stepInfo").innerText = text;
    document.getElementById("progressFill").style.width = percent + "%";
}

function tampilkanPesanUser(text, files) {
    const chatDisplay = document.getElementById("chatDisplay");
    let fileHtml = '';
    
    if (files && files.length > 0) {
        fileHtml = files.map(f => `<div class="msg-file"><i class="fas fa-image"></i> ${f.name}</div>`).join('');
    }

    const msgDiv = document.createElement("div");
    msgDiv.className = "user-msg";
    msgDiv.innerHTML = `${fileHtml} <div>${text}</div>`;
    chatDisplay.appendChild(msgDiv);
    chatDisplay.scrollTop = chatDisplay.scrollHeight;
}

function tampilkanPesanBot(text) {
    const chatDisplay = document.getElementById("chatDisplay");
    const msgDiv = document.createElement("div");
    msgDiv.className = "bot-msg";
    // Menggunakan regex sederhana agar format bold markdown (**) terlihat sedikit lebih rapi di HTML
    const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    msgDiv.innerHTML = formattedText;
    chatDisplay.appendChild(msgDiv);
    chatDisplay.scrollTop = chatDisplay.scrollHeight;
}