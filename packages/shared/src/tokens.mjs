export const STOP = new Set(['a','the','and','or','to','of','in','on','is','it','i','you','we','это','и','в','на','я','ты','мы','что','как','ну','да','нет','же','а']);
export function tokens(text=''){return (String(text).toLowerCase().match(/[\p{L}\p{N}_#@-]{2,}/gu)??[]).filter(t=>!STOP.has(t));}
