const EMAIL_FRAME_CSS = `
  :root {
    color-scheme: light;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    min-height: 100%;
    margin: 0;
    background: #f4f6f8;
    color: #1f2937;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  body {
    padding: 16px;
  }

  .email-root {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    background: #ffffff;
  }

  table {
    max-width: 100%;
  }

  .email-root > table {
    margin-right: auto;
    margin-left: auto;
  }

  img {
    max-width: 100%;
    height: auto;
  }

  a {
    color: #2563eb;
  }

  @media (max-width: 640px) {
    body {
      padding: 10px;
    }

    .email-root {
      max-width: 100%;
    }
  }
`;

export function buildEmailSrcDoc(html: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${EMAIL_FRAME_CSS}</style>
  </head>
  <body>
    <main class="email-root">${html}</main>
  </body>
</html>`;
}
