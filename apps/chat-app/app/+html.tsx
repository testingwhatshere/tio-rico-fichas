import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#0B0F15" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `
          html, body {
            height: 100%;
            overflow: hidden;
            overscroll-behavior: none;
            -webkit-overflow-scrolling: touch;
          }
          html {
            overflow-x: hidden;
            position: fixed;
            width: 100%;
          }
          #root {
            display: flex;
            height: 100%;
            flex: 1;
          }
          input, textarea, select {
            font-size: 16px !important;
          }
        `}} />
      </head>
      <body>{children}</body>
    </html>
  );
}
