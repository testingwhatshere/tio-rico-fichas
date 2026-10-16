/**
 * Usuarios a recontactar tras la mudanza de servidor del 2026-08-29.
 *
 * Son los 141 que habian hecho al menos una carga en la app. Sus telefonos y
 * usuarios quedaron congelados a esa fecha, a proposito: la lista es para
 * avisarles del link nuevo una sola vez, no un padron que haya que mantener.
 * Cuando termine la ronda de contacto, esta pantalla y este archivo se borran.
 *
 * Va hardcodeado y no contra la API porque hacia falta rapido y para un solo
 * uso; el tachado se guarda en el navegador de cada operadora.
 */
export interface UsuarioRecontacto {
  /** Usuario de la app. */
  username: string;
  /** Telefono en formato canonico (549...). */
  phone: string;
  /** Nombre en el panel de juego, si difiere del de la app. */
  panelUsername: string;
  /** Cargas completadas historicas — para priorizar a quien mas usaba. */
  cargas: number;
  /** Fecha de la ultima carga (ISO). */
  ultima: string;
}

export const USUARIOS_RECONTACTO: UsuarioRecontacto[] = [
  {
    "username": "ricardogou91t",
    "phone": "5492622256091",
    "panelUsername": "ricardogou91t",
    "cargas": 15,
    "ultima": "2026-08-29T14:16:38.301Z"
  },
  {
    "username": "paulycas1dic",
    "phone": "5492804654916",
    "panelUsername": "paulycas1dic",
    "cargas": 8,
    "ultima": "2026-08-29T13:46:00.765Z"
  },
  {
    "username": "roxana18dic",
    "phone": "5491144123883",
    "panelUsername": "roxana18dic",
    "cargas": 36,
    "ultima": "2026-08-29T13:41:46.508Z"
  },
  {
    "username": "claudia876",
    "phone": "5493773468370",
    "panelUsername": "claudia876",
    "cargas": 12,
    "ultima": "2026-08-29T12:45:24.170Z"
  },
  {
    "username": "ricardoadrian27",
    "phone": "5493758556507",
    "panelUsername": "ricardoadrian27",
    "cargas": 3,
    "ultima": "2026-08-29T12:44:01.687Z"
  },
  {
    "username": "celina365v",
    "phone": "5493718526485",
    "panelUsername": "celina365v",
    "cargas": 6,
    "ultima": "2026-08-29T12:08:30.862Z"
  },
  {
    "username": "yesivallejo2v",
    "phone": "5493547659995",
    "panelUsername": "yesivallejo2v",
    "cargas": 60,
    "ultima": "2026-08-29T11:26:05.552Z"
  },
  {
    "username": "blas182023",
    "phone": "5491130197426",
    "panelUsername": "blas182023",
    "cargas": 25,
    "ultima": "2026-08-29T11:25:15.048Z"
  },
  {
    "username": "sandra23",
    "phone": "5493834254044",
    "panelUsername": "sandra23",
    "cargas": 14,
    "ultima": "2026-08-29T10:57:19.393Z"
  },
  {
    "username": "valen977may",
    "phone": "5492326468332",
    "panelUsername": "valen977may",
    "cargas": 13,
    "ultima": "2026-08-29T10:47:46.557Z"
  },
  {
    "username": "laureano1243",
    "phone": "5492622352062",
    "panelUsername": "laureano1243",
    "cargas": 2,
    "ultima": "2026-08-29T08:32:28.163Z"
  },
  {
    "username": "ferraz212",
    "phone": "5493755802083",
    "panelUsername": "ferraz212",
    "cargas": 8,
    "ultima": "2026-08-29T06:07:05.188Z"
  },
  {
    "username": "antoo30enero",
    "phone": "5492622570604",
    "panelUsername": "antoo30enero",
    "cargas": 10,
    "ultima": "2026-08-29T06:05:23.175Z"
  },
  {
    "username": "guillo83t",
    "phone": "5492984548309",
    "panelUsername": "guillo83t",
    "cargas": 12,
    "ultima": "2026-08-29T05:49:15.655Z"
  },
  {
    "username": "mony767",
    "phone": "5493865337810",
    "panelUsername": "mony767",
    "cargas": 7,
    "ultima": "2026-08-29T05:44:52.488Z"
  },
  {
    "username": "yamilac2",
    "phone": "5493624774154",
    "panelUsername": "yamilac2",
    "cargas": 27,
    "ultima": "2026-08-29T05:42:23.622Z"
  },
  {
    "username": "dieguito12t",
    "phone": "5492622681062",
    "panelUsername": "dieguito12t",
    "cargas": 5,
    "ultima": "2026-08-29T05:21:08.548Z"
  },
  {
    "username": "marielaquevedo125",
    "phone": "5493826512187",
    "panelUsername": "marielaquevedo125",
    "cargas": 52,
    "ultima": "2026-08-29T05:05:49.075Z"
  },
  {
    "username": "agustin88t",
    "phone": "5492622517789",
    "panelUsername": "agustin88t",
    "cargas": 21,
    "ultima": "2026-08-29T04:57:12.226Z"
  },
  {
    "username": "rufina664c",
    "phone": "5492945683935",
    "panelUsername": "rufina664c",
    "cargas": 12,
    "ultima": "2026-08-29T04:54:44.700Z"
  },
  {
    "username": "juanjo28t",
    "phone": "5491126318028",
    "panelUsername": "juanjo28t",
    "cargas": 3,
    "ultima": "2026-08-29T04:38:23.650Z"
  },
  {
    "username": "caro341",
    "phone": "5493755587205",
    "panelUsername": "caro341",
    "cargas": 11,
    "ultima": "2026-08-29T04:33:24.872Z"
  },
  {
    "username": "maria28c",
    "phone": "5491121828827",
    "panelUsername": "maria28c",
    "cargas": 8,
    "ultima": "2026-08-29T04:32:51.450Z"
  },
  {
    "username": "patricia11c2",
    "phone": "5491161141682",
    "panelUsername": "patricia11c2",
    "cargas": 12,
    "ultima": "2026-08-29T04:19:16.860Z"
  },
  {
    "username": "yesica56c",
    "phone": "5491163065012",
    "panelUsername": "yesica56c",
    "cargas": 1,
    "ultima": "2026-08-29T03:56:20.146Z"
  },
  {
    "username": "gonzalez216ago",
    "phone": "5492657529276",
    "panelUsername": "gonzalez216ago",
    "cargas": 2,
    "ultima": "2026-08-29T03:53:38.049Z"
  },
  {
    "username": "alez49",
    "phone": "5492614170408",
    "panelUsername": "alez49",
    "cargas": 4,
    "ultima": "2026-08-29T03:43:18.170Z"
  },
  {
    "username": "gina3",
    "phone": "5493574457583",
    "panelUsername": "gina3",
    "cargas": 36,
    "ultima": "2026-08-29T03:32:50.421Z"
  },
  {
    "username": "braian73t",
    "phone": "5491122397308",
    "panelUsername": "braian73t",
    "cargas": 37,
    "ultima": "2026-08-29T03:27:28.878Z"
  },
  {
    "username": "pepe33",
    "phone": "5493549461389",
    "panelUsername": "pepe33",
    "cargas": 3,
    "ultima": "2026-08-29T03:26:44.961Z"
  },
  {
    "username": "yaquelina12dic",
    "phone": "5492645280131",
    "panelUsername": "yaquelina12dic",
    "cargas": 14,
    "ultima": "2026-08-29T03:03:54.673Z"
  },
  {
    "username": "itati9feb",
    "phone": "5493794259179",
    "panelUsername": "itati9feb",
    "cargas": 7,
    "ultima": "2026-08-29T02:32:48.897Z"
  },
  {
    "username": "martina34t",
    "phone": "5493874421834",
    "panelUsername": "martina34t",
    "cargas": 5,
    "ultima": "2026-08-29T02:17:54.644Z"
  },
  {
    "username": "sonialuz12dic2",
    "phone": "5492964493161",
    "panelUsername": "sonialuz12dic2",
    "cargas": 80,
    "ultima": "2026-08-29T02:04:47.800Z"
  },
  {
    "username": "daiana18ene",
    "phone": "5493704305134",
    "panelUsername": "daiana18ene",
    "cargas": 3,
    "ultima": "2026-08-29T01:40:53.640Z"
  },
  {
    "username": "alebety20c",
    "phone": "5492614720885",
    "panelUsername": "alebety20c",
    "cargas": 6,
    "ultima": "2026-08-29T01:38:03.855Z"
  },
  {
    "username": "15sebas15",
    "phone": "5492964619386",
    "panelUsername": "15sebas15",
    "cargas": 1,
    "ultima": "2026-08-29T00:45:55.815Z"
  },
  {
    "username": "ian6",
    "phone": "5491141972406",
    "panelUsername": "ian6",
    "cargas": 34,
    "ultima": "2026-08-29T00:44:55.869Z"
  },
  {
    "username": "carla2feb",
    "phone": "5491139158653",
    "panelUsername": "carla2feb",
    "cargas": 5,
    "ultima": "2026-08-29T00:37:35.867Z"
  },
  {
    "username": "graciela12martinez",
    "phone": "5492622588334",
    "panelUsername": "graciela12martinez",
    "cargas": 9,
    "ultima": "2026-08-29T00:35:47.445Z"
  },
  {
    "username": "darian88",
    "phone": "5493725595467",
    "panelUsername": "darian88",
    "cargas": 12,
    "ultima": "2026-08-28T23:21:48.882Z"
  },
  {
    "username": "veronicalatucu11c",
    "phone": "5493884690744",
    "panelUsername": "verolatucu11c",
    "cargas": 6,
    "ultima": "2026-08-28T23:20:01.151Z"
  },
  {
    "username": "romi27dic",
    "phone": "5491138528168",
    "panelUsername": "romi27dic",
    "cargas": 18,
    "ultima": "2026-08-28T22:42:27.634Z"
  },
  {
    "username": "facundo442",
    "phone": "5492345686156",
    "panelUsername": "facundo442",
    "cargas": 6,
    "ultima": "2026-08-28T21:35:04.398Z"
  },
  {
    "username": "jose23c",
    "phone": "5491122882106",
    "panelUsername": "jose23c",
    "cargas": 8,
    "ultima": "2026-08-28T21:32:04.613Z"
  },
  {
    "username": "elian4ene",
    "phone": "5493718468715",
    "panelUsername": "elian4ene",
    "cargas": 2,
    "ultima": "2026-08-28T18:49:33.091Z"
  },
  {
    "username": "luis3dic",
    "phone": "5491144781976",
    "panelUsername": "luis3dic",
    "cargas": 2,
    "ultima": "2026-08-28T18:34:51.470Z"
  },
  {
    "username": "nieva3",
    "phone": "5493865345700",
    "panelUsername": "nieva3",
    "cargas": 86,
    "ultima": "2026-08-28T18:25:55.815Z"
  },
  {
    "username": "pamela8ene",
    "phone": "5493794910706",
    "panelUsername": "pamela8ene",
    "cargas": 16,
    "ultima": "2026-08-28T18:03:55.098Z"
  },
  {
    "username": "irma57abr",
    "phone": "5492616981737",
    "panelUsername": "irma57abr",
    "cargas": 1,
    "ultima": "2026-08-28T17:51:28.762Z"
  },
  {
    "username": "centhu89",
    "phone": "5493625207853",
    "panelUsername": "centhu89",
    "cargas": 1,
    "ultima": "2026-08-28T17:44:19.596Z"
  },
  {
    "username": "xime33",
    "phone": "5492657327572",
    "panelUsername": "xime33",
    "cargas": 4,
    "ultima": "2026-08-28T17:38:52.544Z"
  },
  {
    "username": "lamorocha8env",
    "phone": "5493795593820",
    "panelUsername": "lamorocha8env",
    "cargas": 5,
    "ultima": "2026-08-28T16:13:10.174Z"
  },
  {
    "username": "pitu28ene",
    "phone": "5492942471475",
    "panelUsername": "pitu28ene",
    "cargas": 3,
    "ultima": "2026-08-28T10:12:06.713Z"
  },
  {
    "username": "patry123",
    "phone": "5492622402185",
    "panelUsername": "patry123",
    "cargas": 2,
    "ultima": "2026-08-28T06:09:24.512Z"
  },
  {
    "username": "maru47",
    "phone": "5492966546146",
    "panelUsername": "maru47",
    "cargas": 54,
    "ultima": "2026-08-28T04:14:23.354Z"
  },
  {
    "username": "patricia44",
    "phone": "5492644867434",
    "panelUsername": "patricia44",
    "cargas": 15,
    "ultima": "2026-08-28T04:06:13.164Z"
  },
  {
    "username": "aguero23dic",
    "phone": "5492645873401",
    "panelUsername": "aguero23dic",
    "cargas": 2,
    "ultima": "2026-08-28T03:10:21.894Z"
  },
  {
    "username": "noe66c",
    "phone": "5492214090690",
    "panelUsername": "noe66c",
    "cargas": 7,
    "ultima": "2026-08-28T02:36:50.248Z"
  },
  {
    "username": "freddy147",
    "phone": "5493874031753",
    "panelUsername": "freddy147",
    "cargas": 6,
    "ultima": "2026-08-28T02:36:01.360Z"
  },
  {
    "username": "norma23",
    "phone": "5491167338449",
    "panelUsername": "norma23",
    "cargas": 4,
    "ultima": "2026-08-28T02:07:45.023Z"
  },
  {
    "username": "vanef",
    "phone": "5493754410715",
    "panelUsername": "vanef",
    "cargas": 10,
    "ultima": "2026-08-28T02:01:06.264Z"
  },
  {
    "username": "maira24",
    "phone": "5493764153664",
    "panelUsername": "maira24",
    "cargas": 2,
    "ultima": "2026-08-28T01:53:50.284Z"
  },
  {
    "username": "maria68c",
    "phone": "5491169685489",
    "panelUsername": "maria68c",
    "cargas": 13,
    "ultima": "2026-08-28T00:57:45.379Z"
  },
  {
    "username": "juliana54jul",
    "phone": "5493735486131",
    "panelUsername": "juliana54jul",
    "cargas": 11,
    "ultima": "2026-08-27T23:20:40.563Z"
  },
  {
    "username": "celeste28en",
    "phone": "5492984371863",
    "panelUsername": "celeste28en",
    "cargas": 2,
    "ultima": "2026-08-27T22:41:02.195Z"
  },
  {
    "username": "carmen35t",
    "phone": "5492634223435",
    "panelUsername": "carmen35t",
    "cargas": 2,
    "ultima": "2026-08-27T20:15:09.812Z"
  },
  {
    "username": "helen3c",
    "phone": "5493873656909",
    "panelUsername": "helen3c",
    "cargas": 1,
    "ultima": "2026-08-27T19:35:50.923Z"
  },
  {
    "username": "lautaro600f",
    "phone": "5493512161918",
    "panelUsername": "lautaro600f",
    "cargas": 9,
    "ultima": "2026-08-27T05:54:24.242Z"
  },
  {
    "username": "gladys12abrc",
    "phone": "5492920696108",
    "panelUsername": "gladys12abrc",
    "cargas": 6,
    "ultima": "2026-08-27T05:29:17.967Z"
  },
  {
    "username": "daiana695",
    "phone": "5492615077126",
    "panelUsername": "daiana695",
    "cargas": 1,
    "ultima": "2026-08-27T05:17:01.927Z"
  },
  {
    "username": "maxialexis23",
    "phone": "5493735311001",
    "panelUsername": "maxialexis23",
    "cargas": 2,
    "ultima": "2026-08-27T04:07:17.810Z"
  },
  {
    "username": "andy2026",
    "phone": "54577300",
    "panelUsername": "andy2026",
    "cargas": 26,
    "ultima": "2026-08-27T02:49:16.774Z"
  },
  {
    "username": "ezequiel68jun",
    "phone": "5491172500881",
    "panelUsername": "ezequiel68jun",
    "cargas": 2,
    "ultima": "2026-08-26T20:32:20.627Z"
  },
  {
    "username": "acosta23",
    "phone": "255358398",
    "panelUsername": "acosta23",
    "cargas": 1,
    "ultima": "2026-08-26T19:45:57.416Z"
  },
  {
    "username": "dana12c",
    "phone": "5493764926430",
    "panelUsername": "dana12c",
    "cargas": 22,
    "ultima": "2026-08-26T18:41:36.797Z"
  },
  {
    "username": "johana711",
    "phone": "5492966250122",
    "panelUsername": "johana711",
    "cargas": 2,
    "ultima": "2026-08-26T05:58:40.311Z"
  },
  {
    "username": "sandri68jun",
    "phone": "5493764260662",
    "panelUsername": "sandri68jun",
    "cargas": 41,
    "ultima": "2026-08-26T04:43:31.424Z"
  },
  {
    "username": "melisa9marc",
    "phone": "5492634631214",
    "panelUsername": "melisa9marc",
    "cargas": 4,
    "ultima": "2026-08-26T01:06:13.972Z"
  },
  {
    "username": "maribel336",
    "phone": "5493795582901",
    "panelUsername": "maribel336",
    "cargas": 1,
    "ultima": "2026-08-26T00:07:32.703Z"
  },
  {
    "username": "laurii89t",
    "phone": "5492617218940",
    "panelUsername": "laurii89t",
    "cargas": 3,
    "ultima": "2026-08-25T20:36:20.429Z"
  },
  {
    "username": "exequiel73",
    "phone": "5492995858883",
    "panelUsername": "exequiel73",
    "cargas": 2,
    "ultima": "2026-08-25T14:14:29.272Z"
  },
  {
    "username": "cristian978",
    "phone": "5493512230210",
    "panelUsername": "cristian978",
    "cargas": 8,
    "ultima": "2026-08-25T04:06:26.404Z"
  },
  {
    "username": "ariel985t",
    "phone": "5493489332335",
    "panelUsername": "ariel985t",
    "cargas": 12,
    "ultima": "2026-08-24T21:49:56.683Z"
  },
  {
    "username": "alan85",
    "phone": "5491125428774",
    "panelUsername": "alan85",
    "cargas": 5,
    "ultima": "2026-08-24T21:12:15.942Z"
  },
  {
    "username": "hernan47t",
    "phone": "5491162042176",
    "panelUsername": "hernan47t",
    "cargas": 1,
    "ultima": "2026-08-24T20:10:48.082Z"
  },
  {
    "username": "daiana856",
    "phone": "5492995980354",
    "panelUsername": "daiana856",
    "cargas": 3,
    "ultima": "2026-08-24T02:46:14.046Z"
  },
  {
    "username": "fer988mar",
    "phone": "5493734525999",
    "panelUsername": "fer988mar",
    "cargas": 2,
    "ultima": "2026-08-24T02:17:07.305Z"
  },
  {
    "username": "gabriel1233",
    "phone": "5491139151484",
    "panelUsername": "gabriel1233",
    "cargas": 1,
    "ultima": "2026-08-24T00:25:05.466Z"
  },
  {
    "username": "jorge68jul",
    "phone": "5493764817990",
    "panelUsername": "jorge68jul",
    "cargas": 6,
    "ultima": "2026-08-23T14:32:45.217Z"
  },
  {
    "username": "maridul15963",
    "phone": "5492946519778",
    "panelUsername": "maridul15963",
    "cargas": 4,
    "ultima": "2026-08-22T23:25:31.734Z"
  },
  {
    "username": "ariel792abr",
    "phone": "5493492698792",
    "panelUsername": "ariel792abr",
    "cargas": 6,
    "ultima": "2026-08-22T23:10:36.761Z"
  },
  {
    "username": "ileanna35",
    "phone": "5493764331555",
    "panelUsername": "ileanna35",
    "cargas": 5,
    "ultima": "2026-08-22T22:46:21.555Z"
  },
  {
    "username": "naomi65may",
    "phone": "5493875670838",
    "panelUsername": "naomi65may",
    "cargas": 12,
    "ultima": "2026-08-22T18:43:20.789Z"
  },
  {
    "username": "migue34t",
    "phone": "5493875654901",
    "panelUsername": "migue34t",
    "cargas": 11,
    "ultima": "2026-08-22T18:39:19.924Z"
  },
  {
    "username": "nico56t",
    "phone": "5493875137680",
    "panelUsername": "nico56t",
    "cargas": 8,
    "ultima": "2026-08-22T13:41:52.349Z"
  },
  {
    "username": "taty212",
    "phone": "5493735531212",
    "panelUsername": "taty212",
    "cargas": 2,
    "ultima": "2026-08-22T05:52:54.679Z"
  },
  {
    "username": "juancpe82",
    "phone": "5492622579211",
    "panelUsername": "juancpe82",
    "cargas": 5,
    "ultima": "2026-08-22T05:24:11.519Z"
  },
  {
    "username": "carlos272mar",
    "phone": "5492622542720",
    "panelUsername": "carlos272mar",
    "cargas": 1,
    "ultima": "2026-08-22T04:02:31.381Z"
  },
  {
    "username": "juan5786abr",
    "phone": "5491136316206",
    "panelUsername": "juan5786abr",
    "cargas": 3,
    "ultima": "2026-08-22T03:54:33.715Z"
  },
  {
    "username": "daniela62t",
    "phone": "5492634808828",
    "panelUsername": "daniela62t",
    "cargas": 2,
    "ultima": "2026-08-22T03:09:06.579Z"
  },
  {
    "username": "mailen88m",
    "phone": "5493725449988",
    "panelUsername": "mailen88m",
    "cargas": 3,
    "ultima": "2026-08-22T01:49:34.841Z"
  },
  {
    "username": "gimenez348abr",
    "phone": "5493743563348",
    "panelUsername": "gimenez348abr",
    "cargas": 7,
    "ultima": "2026-08-21T21:14:58.776Z"
  },
  {
    "username": "carlos28oct",
    "phone": "5493489342086",
    "panelUsername": "carlos28oct",
    "cargas": 8,
    "ultima": "2026-08-21T14:46:13.158Z"
  },
  {
    "username": "omar13dic",
    "phone": "5493517545506",
    "panelUsername": "omar13dic",
    "cargas": 99,
    "ultima": "2026-08-20T22:04:08.494Z"
  },
  {
    "username": "marthafort76",
    "phone": "5491225355886",
    "panelUsername": "marthafort76",
    "cargas": 4,
    "ultima": "2026-08-20T14:40:53.203Z"
  },
  {
    "username": "carmen4464c",
    "phone": "5491130699015",
    "panelUsername": "carmen4464c",
    "cargas": 3,
    "ultima": "2026-08-20T02:48:43.380Z"
  },
  {
    "username": "rosalia966mar",
    "phone": "5491135599660",
    "panelUsername": "rosalia966mar",
    "cargas": 7,
    "ultima": "2026-08-20T02:25:46.450Z"
  },
  {
    "username": "carla4febrero",
    "phone": "5492996559546",
    "panelUsername": "carla4febrero",
    "cargas": 2,
    "ultima": "2026-08-20T01:06:30.860Z"
  },
  {
    "username": "alicia147f",
    "phone": "5493735649597",
    "panelUsername": "alicia147f",
    "cargas": 1,
    "ultima": "2026-08-19T23:09:05.628Z"
  },
  {
    "username": "ceci332c",
    "phone": "5492326466520",
    "panelUsername": "ceci332c",
    "cargas": 1,
    "ultima": "2026-08-19T08:55:25.714Z"
  },
  {
    "username": "javier162",
    "phone": "5493877472223",
    "panelUsername": "javier162",
    "cargas": 1,
    "ultima": "2026-08-18T03:31:27.466Z"
  },
  {
    "username": "bautista33",
    "phone": "5493544433081",
    "panelUsername": "bautista33",
    "cargas": 1,
    "ultima": "2026-08-17T22:18:52.545Z"
  },
  {
    "username": "cupa865may",
    "phone": "5492325460940",
    "panelUsername": "cupa865may",
    "cargas": 1,
    "ultima": "2026-08-17T21:59:17.595Z"
  },
  {
    "username": "jonh987t",
    "phone": "5492325473594",
    "panelUsername": "jonh987t",
    "cargas": 1,
    "ultima": "2026-08-17T17:37:07.190Z"
  },
  {
    "username": "paola989abr",
    "phone": "5493434669861",
    "panelUsername": "paola989abr",
    "cargas": 2,
    "ultima": "2026-08-15T23:42:13.868Z"
  },
  {
    "username": "marisa16c",
    "phone": "5491132752449",
    "panelUsername": "marisa16c",
    "cargas": 4,
    "ultima": "2026-08-15T20:18:42.710Z"
  },
  {
    "username": "julian98jul",
    "phone": "5493493401259",
    "panelUsername": "julian98jul",
    "cargas": 1,
    "ultima": "2026-08-15T09:20:38.485Z"
  },
  {
    "username": "daniel54t",
    "phone": "5493735564854",
    "panelUsername": "daniel54t",
    "cargas": 5,
    "ultima": "2026-08-14T22:28:52.292Z"
  },
  {
    "username": "toti32",
    "phone": "5492622276133",
    "panelUsername": "toti32",
    "cargas": 1,
    "ultima": "2026-08-14T06:48:30.070Z"
  },
  {
    "username": "aylen423",
    "phone": "5492555546948",
    "panelUsername": "aylen423",
    "cargas": 2,
    "ultima": "2026-08-13T14:28:17.678Z"
  },
  {
    "username": "juanma10",
    "phone": "5492994657618",
    "panelUsername": "juanma10",
    "cargas": 1,
    "ultima": "2026-08-13T10:14:05.217Z"
  },
  {
    "username": "cristina33",
    "phone": "5493777312648",
    "panelUsername": "cristina33",
    "cargas": 1,
    "ultima": "2026-08-13T08:24:13.431Z"
  },
  {
    "username": "bebi81t",
    "phone": "5493725637081",
    "panelUsername": "bebi81t",
    "cargas": 1,
    "ultima": "2026-08-13T05:13:20.747Z"
  },
  {
    "username": "brenda16c",
    "phone": "5492944630106",
    "panelUsername": "brenda16c",
    "cargas": 3,
    "ultima": "2026-08-11T02:17:36.072Z"
  },
  {
    "username": "arely254t",
    "phone": "5493624112544",
    "panelUsername": "arely254t",
    "cargas": 1,
    "ultima": "2026-08-10T22:58:16.318Z"
  },
  {
    "username": "niko23",
    "phone": "5493874522934",
    "panelUsername": "niko23",
    "cargas": 1,
    "ultima": "2026-08-10T22:58:10.368Z"
  },
  {
    "username": "yovy12",
    "phone": "5492646995439",
    "panelUsername": "yovy12",
    "cargas": 1,
    "ultima": "2026-08-02T03:49:53.514Z"
  },
  {
    "username": "ullorx7",
    "phone": "5493804935636",
    "panelUsername": "ullorx7",
    "cargas": 1,
    "ultima": "2026-08-02T03:48:20.722Z"
  },
  {
    "username": "veronicafue",
    "phone": "5493804520501",
    "panelUsername": "veronicafue",
    "cargas": 2,
    "ultima": "2026-07-17T16:32:48.563Z"
  },
  {
    "username": "soledad69",
    "phone": "5491126092324",
    "panelUsername": "soledad69",
    "cargas": 1,
    "ultima": "2026-07-10T05:47:09.581Z"
  },
  {
    "username": "jeni5mar",
    "phone": "235586988",
    "panelUsername": "jeni5mar",
    "cargas": 4,
    "ultima": "2026-06-22T03:27:05.397Z"
  },
  {
    "username": "fermanda422dic",
    "phone": "52588566",
    "panelUsername": "fermanda422dic",
    "cargas": 2,
    "ultima": "2026-06-16T21:35:40.667Z"
  },
  {
    "username": "nacho44c",
    "phone": "5492920562284",
    "panelUsername": "nacho44c",
    "cargas": 1,
    "ultima": "2026-06-08T17:45:43.312Z"
  },
  {
    "username": "ari12leal",
    "phone": "5493885164415",
    "panelUsername": "ari12leal",
    "cargas": 1,
    "ultima": "2026-06-05T14:08:39.569Z"
  },
  {
    "username": "hhuj",
    "phone": "1112223",
    "panelUsername": "hhuj",
    "cargas": 7,
    "ultima": "2026-06-04T14:24:10.880Z"
  },
  {
    "username": "fulanito",
    "phone": "115926528",
    "panelUsername": "fulanito",
    "cargas": 6,
    "ultima": "2026-06-04T09:23:35.742Z"
  },
  {
    "username": "menganito",
    "phone": "115436798",
    "panelUsername": "menganito",
    "cargas": 2,
    "ultima": "2026-04-14T03:29:33.574Z"
  },
  {
    "username": "fulanita2",
    "phone": "10464846",
    "panelUsername": "fulanita2",
    "cargas": 1,
    "ultima": "2026-04-13T21:55:45.578Z"
  },
  {
    "username": "juanaaa",
    "phone": "46494349",
    "panelUsername": "juanaaa",
    "cargas": 4,
    "ultima": "2026-04-13T05:32:36.133Z"
  },
  {
    "username": "juan123",
    "phone": "",
    "panelUsername": "",
    "cargas": 1,
    "ultima": "2026-03-29T01:56:17.818Z"
  }
];
