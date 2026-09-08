// ================== KONFIGURASI DATABASE (KV CLOUDFLARE) ==================
const DB_KEY = 'e-consultation-db';

async function getDB(env) {
  let data = await env.DB.get(DB_KEY);
  return data ? JSON.parse(data) : { lastNum: 0, records: [] };
}

async function setDB(env, data) {
  await env.DB.put(DB_KEY, JSON.stringify(data));
}

// ================== AUTENTIKASI (Mengambil dari Env Vars) ==================
function getAccounts(env) {
  if (!env.ACCOUNTS_JSON) return {};
  try {
    return JSON.parse(env.ACCOUNTS_JSON);
  } catch (e) {
    return {};
  }
}

// ================== ROUTING UTAMA (API WORKERS) ==================
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS Headers untuk pengembangan lokal
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  
  if (request.method === 'OPTIONS') return new Response(null, { headers });

  // Jika BUKAN API, biarkan file di folder public (index.html) yang tampil
  if (!path.startsWith('/api/')) {
    return context.next();
  }

  const ACCOUNTS = getAccounts(env);

  try {
    // Route: API untuk data awal
    if (path === '/api/init' && request.method === 'GET') {
      const db = await getDB(env);
      const currentNum = (db.lastNum || 0) + 1;
      const strNum = currentNum.toString().padStart(2, '0');
      
      const bulanArr = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
      const hariArr = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
      let today = new Date();
      
      let noForm = `700/${strNum}/Konsultasi/INSPEKTORAT-I/${bulanArr[today.getMonth()].toUpperCase()}/${today.getFullYear()}`;
      let tanggalForm = `${hariArr[today.getDay()]}, ${today.getDate().toString().padStart(2, '0')} ${bulanArr[today.getMonth()]} ${today.getFullYear()}`;
      
      return new Response(JSON.stringify({ noForm, tanggalForm }), { headers });
    }

    // Route: Submit Formulir Utama
    if (path === '/api/submit' && request.method === 'POST') {
      const formData = await request.json();
      if (!formData.nama || !formData.jabatan || !formData.instansi || !formData.hp || !formData.pejabat || !formData.hal || !formData.masalah || !formData.signature || !formData.tujuan) {
        return new Response(JSON.stringify({ status: 'error', message: 'Data belum lengkap!' }), { status: 400, headers });
      }

      let db = await getDB(env);
      let currentNum = (db.lastNum || 0) + 1;
      let strNum = currentNum.toString().padStart(2, '0');
      
      const bulanArr = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
      const hariArr = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
      let today = new Date();
      
      let tujuan = formData.tujuan;
      let statusAwal = "Menunggu Auditor";
      if (tujuan === "PPUPD") statusAwal = "Menunggu PPUPD";
      else if (tujuan === "Irban I" || tujuan === "Irban II" || tujuan === "Irban III") statusAwal = "Menunggu Irban";
      else if (tujuan === "Inspektur") statusAwal = "Menunggu Inspektur";
      
      let rawMasalah = JSON.parse(formData.masalah);
      let masalah = rawMasalah.map(text => ({
        text: text,
        jawaban: { auditor: "", ppupd: "", irban1: "", irban2: "", irban3: "", inspektur: "" },
        status: "Belum Dijawab"
      }));
      
      let record = {
        id: Date.now(),
        noForm: `700/${strNum}/Konsultasi/INSPEKTORAT-I/${bulanArr[today.getMonth()].toUpperCase()}/${today.getFullYear()}`,
        tanggal: `${hariArr[today.getDay()]}, ${today.getDate().toString().padStart(2, '0')} ${bulanArr[today.getMonth()]} ${today.getFullYear()}`,
        nama: formData.nama,
        jabatan: formData.jabatan,
        instansi: formData.instansi,
        hp: formData.hp,
        pejabat: formData.pejabat,
        hal: formData.hal,
        masalah: masalah,
        ttd: formData.signature,
        tujuan: tujuan,
        status: statusAwal,
        irban1: { status: "", catatan: "" },
        irban2: { status: "", catatan: "" },
        irban3: { status: "", catatan: "" },
        survey: null
      };
      
      db.records.push(record);
      db.lastNum = currentNum;
      await setDB(env, db);

      // ====== FITUR KIRIM EMAIL KE GMAIL (RESEND API) ======
      try {
        if (env.RESEND_API_KEY && env.EMAIL_TO) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'E-Consultation <onboarding@resend.dev>',
              to: [env.EMAIL_TO],
              subject: `Konsultasi Baru: ${record.noForm}`,
              html: `<p>Ada konsultasi baru masuk:</p>
                     <ul>
                     <li><b>Nama:</b> ${record.nama}</li>
                     <li><b>Instansi:</b> ${record.instansi}</li>
                     <li><b>Jabatan:</b> ${record.jabatan}</li>
                     <li><b>Ditujukan:</b> ${record.tujuan}</li>
                     <li><b>No HP:</b> ${record.hp}</li>
                     <li><b>Masalah:</b> ${record.masalah.map(m => m.text).join(', ')}</li>
                     </ul>`
            })
          });
          console.log("Email berhasil dikirim!");
        }
      } catch (emailError) {
        console.error("Gagal kirim email:", emailError);
      }
      // ====== SELESAI FITUR EMAIL ======

      return new Response(JSON.stringify({ status: 'success', id: record.id }), { headers });
    }

    // Route: Submit Survei
    if (path === '/api/survey' && request.method === 'POST') {
      const surveyData = await request.json();
      let db = await getDB(env);
      for (let i = 0; i < db.records.length; i++) {
        if (db.records[i].id == surveyData.id) {
          db.records[i].survey = surveyData;
          break;
        }
      }
      await setDB(env, db);
      return new Response(JSON.stringify({ status: 'success' }), { headers });
    }

    // Route: Get Semua Records (Riwayat & Dashboard)
    if (path === '/api/records' && request.method === 'GET') {
      let db = await getDB(env);
      return new Response(JSON.stringify((db.records || []).reverse()), { headers });
    }

    // Route: Get Record by ID (Cek Status)
    if (path.startsWith('/api/record/') && request.method === 'GET') {
      let id = path.split('/')[3];
      let db = await getDB(env);
      let rec = db.records.find(r => r.id == id);
      return new Response(JSON.stringify(rec || null), { headers });
    }

    // Route: Login & Verifikasi
    if (path === '/api/verify' && request.method === 'POST') {
      const { actionType, id, username, password, jawaban, masalahIndex } = await request.json();
      let acc = ACCOUNTS[username];
      
      if (!acc || acc.password !== password) return new Response(JSON.stringify({ status: 'error', message: 'Username atau password salah!' }), { status: 401, headers });
      
      let db = await getDB(env);
      let recordIndex = db.records.findIndex(r => r.id == id);
      if (recordIndex === -1) return new Response(JSON.stringify({ status: 'error', message: 'Data tidak ditemukan!' }), { status: 404, headers });
      
      let record = db.records[recordIndex];
      
      // Logika cek akses role
      if (acc.role !== 'Form') {
        if (actionType === 'auditor_verify' && acc.role !== 'Auditor') return new Response(JSON.stringify({ status: 'error', message: 'Akses tidak sesuai!' }), { status: 403, headers });
        if (actionType === 'ppupd_review' && acc.role !== 'PPUPD') return new Response(JSON.stringify({ status: 'error', message: 'Akses tidak sesuai!' }), { status: 403, headers });
        if (actionType === 'irban_decision' && !['Irban I', 'Irban II', 'Irban III'].includes(acc.role)) return new Response(JSON.stringify({ status: 'error', message: 'Akses tidak sesuai!' }), { status: 403, headers });
        if (actionType === 'inspektur_decision' && acc.role !== 'Inspektur') return new Response(JSON.stringify({ status: 'error', message: 'Akses tidak sesuai!' }), { status: 403, headers });
      } else {
        return new Response(JSON.stringify({ status: 'error', message: 'Akun Form tidak memiliki akses!' }), { status: 403, headers });
      }

      let idx = parseInt(masalahIndex);
      if (typeof record.masalah[idx] === 'string') {
        record.masalah[idx] = { text: record.masalah[idx], jawaban: { auditor: "", ppupd: "", irban1: "", irban2: "", irban3: "", inspektur: "" }, status: "Belum Dijawab" };
      }
      if (!record.masalah[idx].jawaban) record.masalah[idx].jawaban = { auditor: "", ppupd: "", irban1: "", irban2: "", irban3: "", inspektur: "" };

      if (actionType === 'auditor_verify') {
        record.masalah[idx].jawaban.auditor = jawaban;
      } else if (actionType === 'ppupd_review') {
        record.masalah[idx].jawaban.ppupd = jawaban;
      } else if (actionType === 'irban_decision') {
        let irbanNum = (acc.role === 'Irban I') ? 1 : (acc.role === 'Irban II') ? 2 : 3;
        record.masalah[idx].jawaban['irban' + irbanNum] = jawaban;
      } else if (actionType === 'inspektur_decision') {
        record.masalah[idx].jawaban.inspektur = jawaban;
      }
      
      record.masalah[idx].status = "Sudah Dijawab";
      await setDB(env, db);
      return new Response(JSON.stringify({ status: 'success' }), { headers });
    }

    // Route: Finalisasi Verifikasi
    if (path === '/api/complete' && request.method === 'POST') {
      const { actionType, id, username, password, keputusan } = await request.json();
      let acc = ACCOUNTS[username];
      if (!acc || acc.password !== password) return new Response(JSON.stringify({ status: 'error', message: 'Username atau password salah!' }), { status: 401, headers });
      
      let db = await getDB(env);
      let recordIndex = db.records.findIndex(r => r.id == id);
      let record = db.records[recordIndex];
      let semuaTerjawab = record.masalah.every(m => m.status === "Sudah Dijawab");
      if (!semuaTerjawab) return new Response(JSON.stringify({ status: 'error', message: 'Masih ada masalah yang belum dijawab!' }), { status: 400, headers });

      if (actionType === 'auditor_verify') {
        record.status = (record.tujuan === 'Lainnya') ? 'Menunggu PPUPD' : 'Menunggu Irban';
      } else if (actionType === 'ppupd_review') {
        record.status = 'Menunggu Irban';
      } else if (actionType === 'irban_decision') {
        let irbanNum = (acc.role === 'Irban I') ? 1 : (acc.role === 'Irban II') ? 2 : 3;
        record['irban' + irbanNum].status = keputusan;
        if (record.irban1.status === 'tidak' || record.irban2.status === 'tidak' || record.irban3.status === 'tidak') {
          record.status = 'Ditolak Irban';
        } else {
          record.status = 'Menunggu Inspektur';
        }
      } else if (actionType === 'inspektur_decision') {
        record.status = (keputusan === 'setuju') ? 'Disetujui Inspektur' : 'Ditolak Inspektur';
      }

      await setDB(env, db);
      return new Response(JSON.stringify({ status: 'success' }), { headers });
    }

    // Route: Hapus Data (khusus Irban)
    if (path === '/api/delete' && request.method === 'POST') {
      const { id, username, password } = await request.json();
      let acc = ACCOUNTS[username];
      if (!acc || acc.password !== password || !['Irban I', 'Irban II', 'Irban III'].includes(acc.role)) return new Response(JSON.stringify({ status: 'error', message: 'Akses ditolak!' }), { status: 403, headers });
      
      let db = await getDB(env);
      db.records = db.records.filter(rec => rec.id != id);
      await setDB(env, db);
      return new Response(JSON.stringify({ status: 'success' }), { headers });
    }

    return new Response(JSON.stringify({ status: 'error', message: 'Route tidak ditemukan' }), { status: 404, headers });
  } catch (e) {
    return new Response(JSON.stringify({ status: 'error', message: e.message }), { status: 500, headers });
  }
}
