# Wallet notification fixtures

Capturás acá las notificaciones push reales que cada billetera AR emite cuando recibís una
transferencia entrante. Cada fixture sirve como input para escribir / refinar el parser
correspondiente en `apps/wallet-listener-android/app/src/main/kotlin/io/tiorico/walletlistener/parsers/`.

## Formato

Un archivo `.txt` por billetera. Múltiples ejemplos separados por `---`:

```
wallet: brubank
title: ¿Recibiste $5.000?
text: Juan Pérez te transfirió $5.000 a tu cuenta Brubank
bigText:

---

wallet: brubank
title: Te llegó plata
text: María García - $12.500,00
bigText: María García te envió $12.500,00 desde Banco Galicia. Operación 982374.
```

## Pendientes

| Wallet | Estado | Ejemplos |
|--------|--------|----------|
| brubank.txt | ❌ falta | 0 |
| uala.txt | ❌ falta | 0 |
| naranjax.txt | ❌ falta | 0 |
| personalpay.txt | ❌ falta | 0 |
| cuentadni.txt | ❌ falta | 0 |
| galicia.txt | ❌ falta | 0 |
| santander.txt | ❌ falta | 0 |
| bbva.txt | ❌ falta | 0 |
| nacion.txt | ❌ falta | 0 |
| lemon.txt | ❌ falta | 0 |
| belo.txt | ❌ falta | 0 |
| buenbit.txt | ❌ falta | 0 |

Apuntá a 3-5 ejemplos por wallet, idealmente cubriendo:
- Monto chico ($500)
- Monto grande ($500.000+)
- Sender con tildes y mayúsculas mixtas
- Casos donde la notif diga el monto solo en `title` o solo en `bigText`
