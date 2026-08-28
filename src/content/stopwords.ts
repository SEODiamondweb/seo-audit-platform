/**
 * Stopword italiane e inglesi.
 *
 * Servono a due cose nell'estrazione delle keyword: escludere le parole singole prive di
 * significato tematico, e scartare le locuzioni che iniziano o finiscono con una di esse
 * ("della casa", "e il servizio"), che non sono chiavi di ricerca plausibili.
 */
export const STOPWORDS_IT = new Set([
  'a', 'ad', 'ai', 'al', 'alla', 'alle', 'allo', 'agli', 'anche', 'ancora', 'avere', 'aveva',
  'avuto', 'ben', 'bene', 'c', 'che', 'chi', 'ci', 'cioe', 'cioè', 'col', 'come', 'con', 'contro',
  'cosa', 'cui', 'da', 'dai', 'dal', 'dalla', 'dalle', 'dallo', 'dagli', 'degli', 'dei', 'del',
  'della', 'delle', 'dello', 'dentro', 'di', 'dopo', 'dove', 'due', 'e', 'ed', 'egli', 'ecco',
  'era', 'erano', 'essere', 'essi', 'fa', 'fare', 'fatto', 'fin', 'fino', 'fra', 'gli', 'grande',
  'ha', 'hai', 'hanno', 'ho', 'i', 'il', 'in', 'io', 'l', 'la', 'le', 'lei', 'li', 'lo', 'loro',
  'lui', 'ma', 'me', 'mentre', 'mi', 'mia', 'mie', 'miei', 'mio', 'modo', 'molto', 'ne', 'negli',
  'nei', 'nel', 'nella', 'nelle', 'nello', 'no', 'noi', 'non', 'nostra', 'nostro', 'o', 'og',
  'ogni', 'oltre', 'ora', 'per', 'perche', 'perché', 'pero', 'però', 'piu', 'più', 'poco', 'poi',
  'porta', 'prima', 'puo', 'può', 'qual', 'quale', 'quali', 'qualche', 'quando', 'quanto', 'quel',
  'quella', 'quelle', 'quelli', 'quello', 'questa', 'queste', 'questi', 'questo', 'qui', 'quindi',
  // Forme elise: dopo la tokenizzazione l'apostrofo sparisce, quindi "dell'articolo" diventa
  // ["dell", "articolo"]. Senza queste voci si producono locuzioni come "indice dell articolo".
  'all', 'anch', 'coll', 'dall', 'dell', 'dov', 'nell', 'quest', 'quell', 'sull', 'sant', 'tutt',
  's', 'sara', 'sarà', 'se', 'sei', 'sempre', 'senza', 'si', 'sia', 'siamo', 'siete', 'solo',
  'sono', 'sopra', 'sotto', 'sta', 'stata', 'stato', 'stesso', 'su', 'sua', 'sue', 'sui', 'sul',
  'sulla', 'sulle', 'sullo', 'suo', 'suoi', 'tra', 'tre', 'troppo', 'tu', 'tua', 'tue', 'tuo',
  'tuoi', 'tutti', 'tutto', 'un', 'una', 'uno', 'va', 'vi', 'voi', 'vostra', 'vostro',
]);

export const STOPWORDS_EN = new Set([
  'a', 'about', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but', 'by',
  'can', 'do', 'for', 'from', 'get', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
  'its', 'just', 'more', 'most', 'my', 'no', 'not', 'of', 'on', 'one', 'or', 'our', 'out', 'so',
  'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'up',
  'was', 'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with', 'you', 'your',
]);

const ALL = new Set([...STOPWORDS_IT, ...STOPWORDS_EN]);

export function isStopword(word: string): boolean {
  return ALL.has(word);
}
