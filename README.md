<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f752c6a4-f1ac-4c58-b148-115bbb0668ad

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. For static hosting auth, configure Supabase in `.env.local`:
   `VITE_SUPABASE_URL=...`
   `VITE_SUPABASE_ANON_KEY=...`
4. Optional: if you still use the Express API locally, configure:
   `VITE_API_BASE_URL=http://localhost:3000`
5. Run the app:
   `npm run dev`

## Supabase Status

- `login`, `cadastro`, `sessao`, `recuperacao de senha`, `settings`, `holeriths`, `referencia` e `simulator-plan` devem usar Supabase no frontend.
- O app nao deve mais fazer fallback automatico para a API/SQLite quando o objetivo for carregar ou salvar dados de negocio.
- Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` para usar o sistema.
