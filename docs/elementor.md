# Embutir no Elementor (ou em qualquer CMS)

O arquivo **`elementor/esquenta-privateday.html`** é o app inteiro num arquivo só: HTML, CSS, JavaScript e as imagens da marca (embutidas em base64). Não existe arquivo companheiro para subir junto.

Ele é **gerado** a partir do `index.html` da raiz — nunca edite o arquivo da pasta `elementor/` à mão:

```bash
python3 tools/build-elementor.py
```

## Como usar (recomendado: iframe)

**1. Suba o arquivo para o seu próprio domínio.**
Ex.: `https://privateday.auvp.com.br/esquenta/esquenta-privateday.html` (via FTP/gerenciador de arquivos da hospedagem, ou a biblioteca de mídia se o WordPress aceitar `.html`).

> **Hospede no mesmo domínio do site.** Num iframe de outro domínio (por exemplo apontando para o `*.vercel.app`), Safari e Chrome tratam o armazenamento como "de terceiro" e isolam ou bloqueiam `localStorage` **e** cookies — o visitante refaria o boneco a cada visita. Mesmo domínio = armazenamento normal.

**2. No Elementor, adicione um widget "HTML"** e cole:

```html
<div class="esquenta-wrap">
  <iframe id="esquentaPista"
    src="/esquenta/esquenta-privateday.html"
    title="Esquenta AUVP Private Day"
    allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
    allowfullscreen
    loading="lazy"></iframe>
</div>
<style>
  .esquenta-wrap { width: 100%; }
  .esquenta-wrap iframe {
    display: block; width: 100%; height: 88vh; min-height: 620px;
    border: 0; border-radius: 14px; background: #050505;
  }
  @media (max-width: 767px) {
    .esquenta-wrap iframe { height: 92vh; min-height: 560px; border-radius: 0; }
  }
</style>
<script>
  // repassa as UTMs da página (ex.: ?utm_source=instagram) para a pista
  if (location.search) document.getElementById('esquentaPista').src += location.search;
</script>
```

**UTMs**: o script acima repassa a campanha da página para o app, que a cola no link "Garantir ingresso". No mesmo domínio o app também lê a página sozinho, mas o repasse vale até para iframe de outro domínio.

**O atributo `allow` não é opcional**: sem ele o navegador não repassa a permissão de autoplay para o player do YouTube que roda dentro do app, e a música não começa sozinha.

**3. Na seção do Elementor**, deixe o padding lateral em 0 (ou use largura total) para a pista aproveitar a tela no celular.

### Por que iframe, e não colar o conteúdo direto

O app foi feito para ocupar a tela inteira e traz o Tailwind por CDN. Colado direto num widget HTML, ele:

- aplica o *preflight* do Tailwind (um reset de CSS global) em **toda** a página do WordPress — títulos, botões e listas do seu tema perdem o estilo;
- disputa `body { overflow: hidden }` e altura `100dvh` com o layout do Elementor;
- expõe os `id`s do app (`#chatInput`, `#playerContainer`, …) a colisões com o tema e outros plugins.

O iframe resolve os três de uma vez, com isolamento completo de CSS e JS. É também o motivo de o arquivo ser autocontido: um upload, um caminho, sem quebrar imagem.

## Manutenção

O `index.html` da raiz continua sendo a fonte da verdade. Depois de qualquer alteração nele:

```bash
python3 tools/build-elementor.py   # regenera elementor/esquenta-privateday.html
```

e suba o arquivo novo por cima do antigo. Para confirmar em produção que a versão subiu, abra o modal de personalização e confira o carimbo **build** no rodapé (vem do `<meta name="app-build">`).

## O que continua vindo de CDN

Não dá para embutir, e o app depende de rede de qualquer forma (é um app em tempo real): Tailwind, Google Fonts, o servidor da pista (Cloudflare, por WebSocket), DiceBear (os avatares), Three.js (opcional, com fallback 2D) e o player do YouTube. A lista completa de domínios que precisam estar liberados está em [deploy.md](deploy.md).

Se a página do WordPress tiver uma política de segurança de conteúdo (CSP) restritiva, esses domínios precisam entrar nela — o iframe herda a CSP do documento que o serve, não a da página hospedeira.
