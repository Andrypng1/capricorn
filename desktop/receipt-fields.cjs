const methods = [
  ["PayPal", /\bpay\s*pal\b/i],
  ["Binance", /\bbinance\b/i],
  ["Wise", /\b(?:wise|transferwise)\b/i],
  ["Transferencia bancaria", /\b(?:transferencia bancaria|bank transfer|wire transfer|transferencia (?:ach|spei|sepa))\b/i],
  ["Efectivo", /\b(?:efectivo|cash payment|paid in cash)\b/i],
  ["Stripe", /\bstripe\b/i],
  ["Payoneer", /\bpayoneer\b/i],
];
const months = ["enero|january","febrero|february","marzo|march","abril|april","mayo|may","junio|june",
  "julio|july","agosto|august","septiembre|setiembre|september","octubre|october","noviembre|november","diciembre|december"];
const currency = "(?:USDT|USD|USDC|EUR|MXN|DOP|CRC|COP|GBP|BRL|ARS|CAD|AUD|PEN|CLP|RD\\$|US\\$|\\$|€|£)";
const money = new RegExp("^\\s*([+-])?\\s*(" + currency + ")?\\s*([+-])?\\s*(\\d[\\d.,]*)(?:\\s*(" + currency + "))?\\s*(?:$|[;)])", "i");
const explicitMoney = new RegExp("(?:[+-]?\\s*" + currency + "\\s*[+-]?\\s*\\d[\\d.,]*(?:\\s*" + currency + ")?|[+-]?\\s*\\d[\\d.,]*\\s*" + currency + ")\\s*$", "i");

function parseMoney(text) {
  const match = text.trim().replace(/[−–]/g,"-").match(money);
  if (!match) return null;
  let amount = match[4];
  const last = Math.max(amount.lastIndexOf(","), amount.lastIndexOf("."));
  if (last >= 0) {
    const digits = amount.length - last - 1;
    if (digits === 1 || digits === 2) amount = amount.slice(0,last).replace(/[,.]/g,"") + "." + amount.slice(last+1);
    else if (digits === 3 && !/[,.]/.test(amount.slice(0,last))) amount = amount.replace(/[,.]/g,"");
    else return null;
  }
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(amount)) return null;
  const code = (match[5] || match[2] || "").toUpperCase();
  const unit = ({ "US$":"USD","RD$":"DOP","€":"EUR","£":"GBP" })[code] ?? code;
  return { amount, unit, negative:match[1] === "-" || match[3] === "-" };
}

function amountAfter(lines, labels) {
  for (const label of labels) {
    for (let i=0; i<lines.length; i++) {
      const match = lines[i].match(label);
      if (!match) continue;
      const remainder = lines[i].slice(match[0].length);
      const found = parseMoney(remainder) ?? (!remainder.trim() && i+1 < lines.length ? parseMoney(lines[i+1]) : null);
      if (found) return found;
    }
  }
  return null;
}

function dateIn(text) {
  const valid = (y,m,d) => {
    const value = String(y) + "-" + String(m).padStart(2,"0") + "-" + String(d).padStart(2,"0");
    const day = new Date(value + "T00:00:00Z");
    return Number.isFinite(day.getTime()) && day.toISOString().slice(0,10) === value ? value : "";
  };
  const iso = text.match(/\b(20\d{2})\s*[-/.]\s*(\d(?:\s?\d)?)\s*[-/.]\s*(\d{1,2})\b/);
  if (iso) {
    const date = valid(iso[1],Number(iso[2].replace(/\s/g,"")),Number(iso[3]));
    if (date) return date;
  }
  const label = months.join("|");
  const spanish = text.match(new RegExp("\\b(\\d{1,2})\\s+de\\s+("+label+")\\s+(?:de\\s+)?(20\\d{2})\\b","i"));
  const english = text.match(new RegExp("\\b("+label+")\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b","i"));
  if (spanish || english) {
    const name = (spanish?.[2] ?? english[1]).toLowerCase();
    return valid((spanish ?? english)[3], months.findIndex((value) => value.split("|").includes(name))+1, Number(spanish?.[1] ?? english[2]));
  }
  const numeric = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/);
  if (numeric) {
    const [,a,b,y] = numeric.map(Number);
    if (a>12 || a===b) return valid(y,b,a);
    if (b>12) return valid(y,a,b);
  }
  return "";
}

function suggest(text) {
  const source = text.slice(0,20000);
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const platform = methods.find(([,pattern]) => pattern.test(source))?.[0] ??
    (/\bUSDT\b/i.test(source) && /cuenta spot|spot account|id\.?\s+de la orden/i.test(source) ? "Binance" : "");
  const printedMethod = lines.find((line) => /^(?:plataforma|método de pago|payment method)[: ]+\S/i.test(line))
    ?.replace(/^(?:plataforma|método de pago|payment method)[: ]+/i,"").slice(0,80) ?? "";
  const grossLabels = [/^(?:importe bruto|monto bruto|gross amount|total pagado|total recibido|amount paid|amount received|importe total|monto total)\s*[: ]*/i,
    /^(?:total|monto|importe|amount)(?=\s|:|$)\s*[: ]*/i, /^(?:pagado con|saldo de paypal|paid with|transfer amount)\s*[: ]*/i];
  let total = amountAfter(lines,grossLabels);
  if (!total) {
    const amounts = lines.filter((line) => !/^(?:comisi[oó]n|tarifa|fee|neto|net)/i.test(line))
      .map((line) => line.match(explicitMoney)?.[0]).filter(Boolean).map(parseMoney).filter(Boolean);
    const unique = new Set(amounts.map(({amount,unit}) => Number(amount) + "|" + unit));
    if (unique.size === 1) total = amounts[0];
  }
  const fee = amountAfter(lines,[/^(?:comisi[oó]n(?:\s+del servicio)?|tarifa|cargo por servicio|transaction fee|fee)\s*[: ]*/i]);
  let reference = "";
  for (let i=0;i<lines.length;i++) {
    const label = lines[i].match(/^(?:id\.?\s*(?:de\s+)?(?:la\s+)?(?:transacci[oó]n|orden|operaci[oó]n|pago)|(?:transaction|payment|order|transfer)\s+(?:id|number|reference)|(?:n[úu]mero|n[.º°]+)\s*(?:de\s+)?(?:transacci[oó]n|orden|pago)|referencia(?:\s+del pago)?|c[oó]digo de operaci[oó]n)\s*[:# ]*/i);
    if (!label) continue;
    const value = lines[i].slice(label[0].length) || lines[i+1] || "";
    const token = value.match(/^([a-z0-9][a-z0-9-]{3,79})(?:\s|$)/i)?.[1];
    if (token && /\d/.test(token)) { reference=token; break; }
  }
  const unit = total?.unit || fee?.unit || "";
  const foreign = Boolean(unit && !["USD","$"].includes(unit));
  const feeForeign = Boolean(fee?.unit && !["USD","$"].includes(fee.unit));
  const outgoing = Boolean(total?.negative || /monto\s*\r?\n\s*[−-]\s*\d/i.test(source));
  return {
    amount:total?.amount ?? "", fee:fee?.amount ?? "", reference, platform:platform || printedMethod, date:dateIn(source),
    currency:unit, feeCurrency:fee?.unit ?? "", foreign, feeForeign, outgoing, text:source,
  };
}

module.exports = { suggest };