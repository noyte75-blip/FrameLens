# FrameLens Studio 2.1 — Netlify

Tradutor de **textos presentes nas imagens do vídeo**, independentemente do áudio. Ele detecta a escrita por OCR, traduz, reconstrói apenas os pixels próximos às letras detectadas e desenha novo texto em **uma área rigidamente limitada à região da escrita original**. Você pode revisar as traduções e os estilos antes de exportar um WebM.

## Uso rápido — baixar vídeo traduzido

1. Clique em **Arraste seu vídeo aqui** ou escolha um arquivo MP4/WebM; também há um vídeo de demonstração.
2. Escolha o idioma original e o idioma de destino.
3. Clique em **Detectar e traduzir** e aguarde a leitura do vídeo e a tradução automática.
4. Confira a prévia; altere qualquer texto, fonte ou cor que precisar. Traduções que falharam precisam ser preenchidas antes de baixar.
5. Quando todos os trechos estiverem traduzidos, o botão **Baixar vídeo traduzido** será ativado no painel à direita. Clique nele e mantenha a aba aberta durante a geração.
6. O navegador baixa o arquivo `nome-do-video-traduzido.webm`, contendo o vídeo refeito com o texto traduzido na imagem. O áudio original é incluído quando o navegador permite.

> O download gera um **novo vídeo**, não apenas um arquivo de legendas. O formato de vídeo exportado é WebM, não MP4. Para melhor compatibilidade, use Chrome ou Edge no computador. O navegador pode exigir que o usuário permita downloads.

## Publicar no Netlify (com funções funcionando)

1. Descompacte a pasta e coloque todo o conteúdo no seu **repositório GitHub** (mantenha as pastas `public/` e `netlify/functions/` e o arquivo `netlify.toml`).
2. No **Netlify**, selecione **Add new project → Import an existing project → GitHub** e conecte seu repositório.
3. O `netlify.toml` já define a pasta de publicação **`public`** e a função `/.netlify/functions/translate` (apelido `/api/translate`). Não precisa configurar build nem instalar dependências de produção.
4. Clique em **Deploy**. Após a publicação, teste com o botão *Usar vídeo de exemplo*.
5. Opcional: nas variáveis de ambiente do projeto, configure `DEEPL_API_KEY` (e `DEEPL_API_URL=https://api.deepl.com/v2/translate` se a chave for da modalidade paga). Sem chave, a função usa o serviço gratuito **MyMemory**, que tem cotas e restrições.

> **Importante**: o arrastar-e-soltar de uma pasta estática no painel do Netlify pode publicar só o HTML, sem a função de tradução. Para funcionamento completo use deploy pelo GitHub ou Netlify CLI com funções.

## Executar localmente

Requer Node.js 20+:

```bash
npm start
```

Acesse `http://localhost:3000`. O servidor local implementa `/api/translate` igual à Netlify Function. **Não é necessário `npm install`.**

Rode testes unitários:

```bash
npm test
```

## Funcionalidades

- Upload de MP4 / WebM (ou arquivo que o navegador conseguir abrir), vídeo no navegador.
- Reconhecimento Tesseract.js 6, com idiomas selecionáveis (na primeira vez ele baixa dados OCR da internet).
- Análise de um quadro a cada 0,5 a 3 s (em vídeos grandes, máximo de 250 amostras para limitar memória e custo).
- Associação simples de textos entre quadros consecutivos, para ajudar com texto em movimento.
- Reparação de pixels estimados como letras, sem expandir a caixa original. Em áreas complexas, reparação não é perfeita.
- Seleção automática **aproximada** de tipografia/cor, com controles para editar texto, família de fonte, cor, tamanho e contorno.
- Ajuste automático da largura do texto traduzido, até com compressão horizontal, sempre recortado aos limites originais. A ferramenta **avisa** quando o texto ficou comprimido e precisa de encurtamento manual.
- Comparador visual original/traduzido, reprodução e revisão de trechos.
- Download do vídeo traduzido em WebM e exportação opcional de SRT (se suportado pelo navegador), com áudio original quando o suporte a captura Web Audio permitir. A exportação é em **tempo real** — exige manter a aba aberta enquanto o vídeo é reproduzido.

## Privacidade

O arquivo de vídeo é processado localmente no navegador (canvas, vídeo e OCR). **Somente os textos identificados** são enviados pela função Netlify a um serviço externo (MyMemory ou DeepL) para tradução. Não use o serviço para textos confidenciais sem avaliar as políticas dos fornecedores.

## Limitações honestas

Isto é um **MVP avançado**, não um sistema de reiluminação/inpainting generativo com fidelidade profissional. A reparação é local, com máscara de cores e interpolação de pixels; fundos muito complexos podem deixar resíduos ou artefatos. O OCR não detectará todos os textos em quadros intermediários, fontes ornamentadas ou conteúdo girando rapidamente. Tracking é aproximado, não um rastreador de perspectiva completo. A escolha da família tipográfica é uma aproximação heurística — não identifica a fonte exata. Texto muito maior do que a caixa original pode ficar comprimido e precisar ser reescrito manualmente. Vídeo MP4 não é exportado diretamente (o contêiner gerado é WebM). Alguns navegadores não permitem captura de áudio ou WebM; use Chrome/Edge recentes para melhores resultados.

Evite publicar o projeto na Internet sem acrescentar proteção de uso/rate limiting à função de tradução: os serviços gratuitos têm limites de cota.

## Arquivos principais

- `public/index.html` — página e editor
- `public/styles.css` — layout responsivo
- `public/app.js` — OCR, tradução, reprodução, edição, exportação
- `public/visual-engine.js` — detecção de estilo e reconstrução visual conservadora
- `netlify/functions/translate.mjs` — proxy de tradução sem enviar vídeos
- `netlify.toml` — publicação Netlify
- `dev-server.mjs` — servidor de desenvolvimento simples
