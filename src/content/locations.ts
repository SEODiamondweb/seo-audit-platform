/**
 * Nomi di luogo italiani, esclusi dall'estrazione delle keyword.
 *
 * Una località non è l'argomento di una pagina: è dove il servizio viene erogato. Lasciandola
 * fra le keyword, le pagine di un'azienda con più sedi finiscono per avere tutte come argomento
 * il nome della città, che non distingue nulla e nasconde il servizio di cui la pagina parla.
 *
 * Sono volutamente assenti i toponimi che coincidono con parole comuni — Vita, Prato, Massa,
 * Alba, Fermo, Latina, Este, Ala, Bra, Forte, Campo, Sale, Sesto — perché escluderli
 * spezzerebbe locuzioni legittime: "linea vita" è un dispositivo anticaduta, non un comune
 * del trapanese. Meglio non filtrare una località in più che rompere una keyword vera.
 */

const REGIONS = [
  'abruzzo', 'basilicata', 'calabria', 'campania', 'emilia', 'romagna', 'friuli', 'lazio',
  'liguria', 'lombardia', 'marche', 'molise', 'piemonte', 'puglia', 'sardegna', 'sicilia',
  'toscana', 'trentino', 'umbria', 'valle', 'aosta', 'veneto', 'alto', 'adige',
];

const CITIES = [
  'agrigento', 'alessandria', 'ancona', 'andria', 'arezzo', 'ascoli', 'asti', 'avellino',
  'bari', 'barletta', 'belluno', 'benevento', 'bergamo', 'biella', 'bologna', 'bolzano',
  'brescia', 'brindisi', 'cagliari', 'caltanissetta', 'campobasso', 'carbonia', 'caserta',
  'catania', 'catanzaro', 'chieti', 'como', 'cosenza', 'cremona', 'crotone', 'cuneo', 'enna',
  'ferrara', 'firenze', 'foggia', 'forli', 'cesena', 'frosinone', 'genova', 'gorizia',
  'grosseto', 'imperia', 'isernia', 'aquila', 'spezia', 'lecce', 'lecco', 'livorno', 'lodi',
  'lucca', 'macerata', 'mantova', 'matera', 'messina', 'milano', 'modena', 'monza', 'brianza',
  'napoli', 'novara', 'nuoro', 'oristano', 'padova', 'palermo', 'parma', 'pavia', 'perugia',
  'pesaro', 'urbino', 'pescara', 'piacenza', 'pisa', 'pistoia', 'pordenone', 'potenza',
  'ragusa', 'ravenna', 'reggio', 'rieti', 'rimini', 'roma', 'rovigo', 'salerno', 'sassari',
  'savona', 'siena', 'siracusa', 'sondrio', 'taranto', 'teramo', 'terni', 'torino', 'trapani',
  'trento', 'treviso', 'trieste', 'udine', 'varese', 'venezia', 'verbania', 'vercelli',
  'verona', 'vibo', 'valentia', 'vicenza', 'viterbo',
  // Centri non capoluogo ricorrenti nelle pagine di servizio locali
  'busto', 'arsizio', 'gallarate', 'legnano', 'rho', 'sesto', 'giovanni', 'cinisello',
  'moncalieri', 'rivoli', 'collegno', 'settimo', 'torinese', 'chieri', 'pinerolo', 'ivrea',
  'asti', 'casale', 'monferrato', 'vigevano', 'abbiategrasso', 'saronno', 'seregno', 'desio',
  'cantu', 'erba', 'mariano', 'comense', 'olgiate', 'lissone', 'meda', 'vimercate',
];

const GENERIC = [
  'provincia', 'province', 'comune', 'comuni', 'regione', 'regioni', 'italia', 'italiano',
  'italiana', 'nord', 'sud', 'centro', 'dintorni', 'limitrofi', 'limitrofe', 'zona', 'zone',
];

const LOCATIONS = new Set([...REGIONS, ...CITIES, ...GENERIC]);

export function isLocation(word: string): boolean {
  return LOCATIONS.has(word.toLowerCase());
}
