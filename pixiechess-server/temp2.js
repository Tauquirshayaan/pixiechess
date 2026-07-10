function sqToUci(r, c) {
    const file = String.fromCharCode('a'.charCodeAt(0) + c);
    const rank = String(8 - r);
    return file + rank;
}
function uciToSq(uci) {
    const c = uci.charCodeAt(0) - 'a'.charCodeAt(0);
    const r = 8 - parseInt(uci[1]);
    return [r, c];
}
console.log('f4:', uciToSq('f4'));
console.log('e2:', uciToSq('e2'));
