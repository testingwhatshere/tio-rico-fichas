import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { formatAmount } from '@/utils/amount';

interface ReceiptData {
  requestId: string;
  amount: number;
  targetUsername: string;
  status: string;
  createdAt: string;
  completedAt?: string;
}

export const generateReceipt = async (data: ReceiptData) => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            padding: 40px 20px;
            background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
            color: #1f2937;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          }
          .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 30px;
            border-bottom: 3px solid #f59e0b;
          }
          .logo {
            font-size: 56px;
            margin-bottom: 16px;
          }
          .title {
            font-size: 32px;
            color: #f59e0b;
            margin: 0 0 8px 0;
            font-weight: 700;
          }
          .subtitle {
            font-size: 18px;
            color: #6b7280;
            margin: 0;
            font-weight: 500;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 18px 0;
            border-bottom: 1px solid #e5e7eb;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #6b7280;
            font-size: 15px;
            font-weight: 500;
          }
          .info-value {
            color: #1f2937;
            font-weight: 600;
            font-size: 16px;
            text-align: right;
          }
          .amount-section {
            text-align: center;
            margin: 40px 0;
            padding: 32px;
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border-radius: 16px;
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2);
          }
          .amount-label {
            color: #92400e;
            font-size: 14px;
            margin-bottom: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .amount-value {
            font-size: 64px;
            color: #b45309;
            font-weight: 800;
            line-height: 1;
          }
          .status-badge {
            display: inline-block;
            padding: 12px 24px;
            border-radius: 12px;
            background: #10b981;
            color: white;
            font-weight: 700;
            font-size: 16px;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 30px;
            border-top: 2px solid #e5e7eb;
            color: #9ca3af;
            font-size: 13px;
            line-height: 1.6;
          }
          .footer p {
            margin: 8px 0;
          }
          .transaction-id {
            font-family: 'Courier New', monospace;
            background: #f3f4f6;
            padding: 8px 12px;
            border-radius: 6px;
            display: inline-block;
            font-size: 14px;
            margin-top: 8px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🎰</div>
            <h1 class="title">Tio Rico Fichas</h1>
            <p class="subtitle">Comprobante de Carga</p>
          </div>

          <div>
            <div class="info-row">
              <span class="info-label">ID de Transacción</span>
              <span class="info-value">#${data.requestId.slice(0, 8).toUpperCase()}</span>
            </div>

            <div class="info-row">
              <span class="info-label">Usuario</span>
              <span class="info-value">${data.targetUsername}</span>
            </div>

            <div class="info-row">
              <span class="info-label">Fecha de Solicitud</span>
              <span class="info-value">${new Date(data.createdAt).toLocaleDateString('es-AR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}</span>
            </div>

            ${data.completedAt ? `
            <div class="info-row">
              <span class="info-label">Fecha de Confirmación</span>
              <span class="info-value">${new Date(data.completedAt).toLocaleDateString('es-AR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}</span>
            </div>
            ` : ''}
          </div>

          <div class="amount-section">
            <div class="amount-label">Monto Cargado</div>
            <div class="amount-value">$${formatAmount(data.amount)}</div>
          </div>

          <div style="text-align: center;">
            <span class="status-badge">✓ COMPLETADO</span>
          </div>

          <div class="footer">
            <p><strong>Este comprobante certifica la carga exitosa de fichas.</strong></p>
            <div class="transaction-id">ID: ${data.requestId}</div>
            <p style="margin-top: 20px;">Tio Rico Fichas © ${new Date().getFullYear()}</p>
            <p>Todos los derechos reservados</p>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    const { uri } = await Print.printToFileAsync({ html });
    return uri;
  } catch (error) {
    console.error('Error generating receipt:', error);
    throw error;
  }
};

export const downloadReceipt = async (data: ReceiptData) => {
  try {
    const uri = await generateReceipt(data);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Descargar Comprobante',
        UTI: 'com.adobe.pdf',
      });
    } else {
      throw new Error('El sistema no permite compartir archivos');
    }
  } catch (error) {
    console.error('Error downloading receipt:', error);
    throw error;
  }
};
