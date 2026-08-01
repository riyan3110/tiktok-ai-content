# Workflow Orchestrator — Milestone 9

## Tujuan

Workflow Orchestrator menyatukan modul Project, Consistency, Prompt Studio, Prompt Generator, AI Provider, Generation Queue, dan AI Integration dalam satu pengalaman end-to-end. Implementasi sepenuhnya berada di browser dan tidak menambah request API, endpoint, atau perubahan backend.

## Arsitektur

- `public/index.html` menyediakan stepper, builder, summary, recovery banner, progress, dan history.
- `public/workflow.js` adalah state machine tujuh tahap. Satu objek workflow menjadi sumber kebenaran global untuk form, navigasi, validasi, status, serta progress.
- `public/style.css` menyediakan layout desktop, tablet, dan mobile.
- `public/workspace.js` mendaftarkan orchestrator sebagai view workspace tanpa mengubah alur modul lama.

## Persistensi dan Draft

Draft aktif disimpan otomatis (debounce 300 ms) pada `ai-ads-lab-workflow-v1`. Riwayat maksimal 25 sesi berada di `ai-ads-lab-workflow-history-v1`. Saat halaman dibuka ulang, draft tervalidasi secara struktural lalu dipulihkan. JSON rusak diisolasi dengan menghapus draft aktif dan membuat state awal, sementara UI menampilkan pesan recovery.

Semua data memakai `localStorage`. Tombol Generate hanya menjalankan simulasi status lokal (`Draft` → `Generating` → `Completed`) dan menyimpan snapshot ke history.

## Validasi dan Navigasi

Setiap tahap mempunyai aturan field wajib. Pengguna dapat berpindah melalui stepper, tetapi tombol Berikutnya menampilkan error kontekstual bila tahap belum valid. Generate aktif hanya jika ketujuh tahap valid. Progress dihitung dari jumlah tahap valid sehingga mencerminkan kelengkapan data, bukan sekadar posisi navigasi.

## Undo / Redo dan Error Recovery

Perubahan field disimpan sebagai snapshot pada undo stack in-memory (maksimal 50). Redo dibersihkan ketika pengguna membuat perubahan baru. Kegagalan quota localStorage ditampilkan sebagai error yang dapat ditindaklanjuti tanpa menghapus state saat ini.

## Batas Integrasi

Orchestrator tidak memanggil backend dan tidak mengubah storage key Milestone 1–8. Integrasi modul nyata berikutnya dapat menggunakan `window.WorkflowOrchestrator.getState()` dan event browser tanpa mengubah kontrak server.
