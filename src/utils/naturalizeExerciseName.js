// Conserva el movimiento y el equipo del catálogo; solo ordena modificadores
// que quedaron delante del movimiento en la traducción literal.
const LEADING_MODIFIERS = [
  [/^un brazo\b/i, "a un brazo"],
  [/^una pierna\b/i, "a una pierna"],
  [/^dos brazo(?:s)?\b/i, "a dos brazos"],
  [/^dos piernas\b/i, "a dos piernas"],
  [/^agarre cerrado\b/i, "con agarre cerrado"],
  [/^agarre amplio\b/i, "con agarre amplio"],
  [/^agarre inverso\b/i, "con agarre inverso"],
  [/^agarre neutro\b/i, "con agarre neutro"],
  [/^palmas hacia abajo\b/i, "con palmas hacia abajo"],
  [/^palmas hacia arriba\b/i, "con palmas hacia arriba"],
  [/^sobre la cabeza\b/i, "sobre la cabeza"],
  [/^de pie\b/i, "de pie"],
  [/^sentado\b/i, "sentado"],
  [/^acostado\b/i, "acostado"],
  [/^arrodillado\b/i, "arrodillado"],
  [/^boca abajo\b/i, "boca abajo"],
  [/^inclinado\b/i, "inclinado"],
  [/^declinado\b/i, "declinado"],
  [/^alterno\b/i, "alterno"],
  [/^inverso\b/i, "inverso"],
  [/^lateral\b/i, "lateral"],
  [/^frontal\b/i, "frontal"],
  [/^posterior\b/i, "posterior"],
  [/^piernas rectas\b/i, "con piernas rectas"],
  [/^piernas r[ií]gidas\b/i, "con piernas rígidas"],
  [/^sumo\b/i, "sumo"],
];
const MOVEMENT_START = /^(?:curl|press|extensi[oó]n|flexi[oó]n|elevaci[oó]n|fondos|sentadilla|peso muerto|zancada|remo|jal[oó]n|plancha|giro|rotaci[oó]n|encogimiento|estiramiento|puente|patada|abdominal|rueda abdominal|subida|buenos d[ií]as)\b/i;
const EQUIPMENT_END = /\s+(con (?:barra(?: EZ)?|mancuernas|polea|banda el[aá]stica|bal[oó]n medicinal|kettlebell|lastre)|en m[aá]quina Smith)$/i;
const FINAL_NAME_OVERRIDES = new Map([
  ["Push abdominal con banda elástica", "Empuje abdominal con banda elástica"],
  ["Zancada v. 2 posterior con barra", "Zancada posterior con barra (variante 2)"],
  ["Revers curl de muñeca v. 2 con barra", "Curl de muñeca inverso con barra (variante 2)"],
  ["Agarre inverso skullcrusher con barra", "Extensión de tríceps tipo rompecráneos con barra y agarre inverso"],
  ["Lateral flexionado v. 2 con barra", "Flexión lateral con barra (variante 2)"],
  ["Sentadilla dividida v. 2 lateral con barra", "Sentadilla dividida lateral con barra (variante 2)"],
  ["Sitted alterno elevación de piernas con barra", "Elevación alterna de piernas sentado con barra"],
  ["Sitted alterno elevación de piernas (mujer) con barra", "Elevación alterna de piernas sentado con barra (variante 2)"],
  ["Sentadilla dividida v. 2 con barra", "Sentadilla dividida con barra (variante 2)"],
  ["Curl de muñeca v. 2 con barra", "Curl de muñeca con barra (variante 2)"],
  ["Extensión de tríceps v. 2 acostado con polea", "Extensión de tríceps acostado con polea (variante 2)"],
  ["Flexión lateral encogimiento abdominal (bosu balón) con polea", "Encogimiento abdominal lateral sobre BOSU con polea"],
  ["Chair pierna extended estiramiento", "Estiramiento de pierna extendida en silla"],
  ["Encogimiento abdominal (hands sobre la cabeza)", "Encogimiento abdominal con manos sobre la cabeza"],
  ["Hammer curls (con soporte para brazos) con mancuernas", "Curl martillo con mancuernas y soporte para brazos"],
  ["Extensión (across face) acostado con mancuernas", "Extensión de tríceps cruzada frente al rostro acostado con mancuernas"],
  ["Neutral agarre press de banca con mancuernas", "Press de banca con mancuernas y agarre neutro"],
  ["Sobre banco neutral curl de muñeca con mancuernas", "Curl de muñeca con agarre neutro sobre banco y mancuernas"],
  ["Sobre banco un brazo neutral curl de muñeca con mancuernas", "Curl de muñeca a un brazo con agarre neutro sobre banco y mancuerna"],
  ["Elevación de pantorrillas - hammer agarre sentado a una pierna con mancuernas", "Elevación de pantorrillas sentado a una pierna con mancuerna"],
  ["Peso muerto con stepbox support a una pierna con mancuernas", "Peso muerto a una pierna con apoyo en cajón y mancuernas"],
  ["Frog planche", "Planche de rana"],
  ["Glute-ham elevación", "Elevación glúteo-isquiotibial"],
  ["Hands clasped circular toque de pies (hombre)", "Toque circular de pies con manos entrelazadas"],
  ["Hands reversed clasped circular toque de pies (hombre)", "Toque circular de pies con manos entrelazadas detrás de la espalda"],
  ["Inchworm v. 2", "Caminata del gusano (variante 2)"],
  ["Inverse curl femoral (banco support)", "Curl femoral inverso con apoyo en banco"],
  ["Double alterno hang cargada con kettlebell", "Cargada alterna desde suspensión con dos kettlebells"],
  ["Hang cargada con kettlebell", "Cargada desde suspensión con kettlebell"],
  ["Lean planche", "Planche con inclinación"],
  ["Potty sentadilla con support", "Sentadilla profunda con apoyo"],
  ["Plancha con pierna lift inverso", "Plancha inversa con elevación de pierna"],
  ["Self asistido inverse curl femoral (en el suelo)", "Curl femoral inverso autoasistido en el suelo"],
  ["Sledge hammer", "Golpes con maza"],
  ["Split squats", "Sentadilla dividida sin carga"],
  ["Sentadilla en bosu balón", "Sentadilla sobre BOSU"],
  ["Encogimiento abdominal (completo range hands tras nuca) con fitball", "Encogimiento abdominal completo sobre fitball con manos tras nuca"],
  ["Straddle maltese", "Maltese con piernas abiertas"],
  ["Straddle planche", "Planche con piernas abiertas"],
  ["Giro cadera lift", "Elevación de cadera con giro"],
  ["Alterno heel touchers", "Toques alternos de talón"],
  ["Asistido colgado elevación de rodillas", "Elevación de rodillas colgado con asistencia"],
  ["Asistido colgado elevación de rodillas con lanzamiento hacia abajo", "Elevación de rodillas colgado con asistencia y descenso controlado"],
  ["Asistido acostado pantorrillas estiramiento", "Estiramiento asistido de pantorrillas acostado"],
  ["Asistido acostado glúteos estiramiento", "Estiramiento asistido de glúteos acostado"],
  ["Asistido acostado elevación de piernas con lateral lanzamiento hacia abajo", "Elevación lateral de piernas acostado con asistencia y descenso controlado"],
  ["Asistido acostado elevación de piernas con lanzamiento hacia abajo", "Elevación de piernas acostado con asistencia y descenso controlado"],
  ["Asistido motion russian giro", "Giro ruso con asistencia"],
  ["Asistido boca abajo isquiotibiales", "Estiramiento asistido de isquiotibiales boca abajo"],
  ["Asistido boca abajo acostado cuádriceps estiramiento", "Estiramiento asistido de cuádriceps boca abajo"],
  ["Asistido lateral acostado adductor estiramiento", "Estiramiento asistido de aductores acostado de lado"],
  ["Asistido abdominal", "Abdominal asistido"],
  ["Asistido de pie extensión de tríceps (con toalla)", "Extensión de tríceps asistida de pie con toalla"],
  ["Asistido fondos para tríceps (arrodillado)", "Fondos de tríceps asistidos de rodillas"],
  ["Hacia atras salto", "Salto hacia atrás"],
  ["Cadera lift con banda elástica", "Elevación de cadera con banda elástica"],
  ["Arrodillado con giro encogimiento abdominal con banda elástica", "Encogimiento abdominal con giro arrodillado y banda elástica"],
  ["Acostado cadera rotación interna con banda elástica", "Rotación interna de cadera acostado con banda elástica"],
  ["Sentado cadera rotación interna con banda elástica", "Rotación interna de cadera sentado con banda elástica"],
  ["De pie con giro encogimiento abdominal con banda elástica", "Encogimiento abdominal con giro de pie y banda elástica"],
  ["Banco sentadilla frontal con barra", "Sentadilla frontal con barra hasta el banco"],
  ["Banco sentadilla con barra", "Sentadilla con barra hasta el banco"],
  ["Frontal pecho sentadilla con barra", "Sentadilla con barra frontal sobre el pecho"],
  ["Completo zercher sentadilla con barra", "Sentadilla Zercher completa con barra"],
  ["Acostado espalda de la cabeza extensión de tríceps con barra", "Extensión de tríceps acostado con barra detrás de la cabeza"],
  ["Sentado agarre cerrado tras nuca extensión de tríceps con barra", "Extensión de tríceps sentado tras nuca con barra y agarre cerrado"],
  ["De pie ab rueda abdominal con barra", "Rueda abdominal de pie con barra"],
  ["De pie espalda curl de muñeca con barra", "Curl de muñeca detrás de la espalda de pie con barra"],
  ["De pie pierna elevación de pantorrillas con barra", "Elevación de pantorrillas de pie con barra"],
  ["De pie rocking pierna elevación de pantorrillas con barra", "Elevación de pantorrillas con balanceo de pie y barra"],
  ["Basic toque de pies (hombre)", "Toque de pies básico"],
  ["Banco fondos (rodillas flexionado)", "Fondos en banco con rodillas flexionadas"],
  ["Banco fondos en el suelo", "Fondos en banco desde el suelo"],
  ["Banco extensión de cadera", "Extensión de cadera en banco"],
  ["Asistido inverse curl femoral con polea", "Curl femoral inverso asistido con polea"],
  ["Cadera aducción con polea", "Aducción de cadera con polea"],
  ["Posterior drive con polea", "Empuje posterior con polea"],
  ["De pie espalda curl de muñeca con polea", "Curl de muñeca detrás de la espalda de pie con polea"],
  ["De pie lift con polea", "Elevación de pie con polea"],
  ["Banco sentadilla con mancuernas", "Sentadilla con mancuernas hasta el banco"],
  ["Hacia adelante zancada extensión de tríceps con mancuernas", "Zancada hacia delante con extensión de tríceps y mancuernas"],
  ["Acostado codo press con mancuernas", "Press de codos acostado con mancuernas"],
  ["Acostado femoral con mancuernas", "Curl femoral acostado con mancuerna"],
  ["Acostado un brazo pronated extensión de tríceps con mancuernas", "Extensión de tríceps acostado a un brazo con agarre prono y mancuerna"],
  ["Acostado un brazo supinated extensión de tríceps con mancuernas", "Extensión de tríceps acostado a un brazo con agarre supino y mancuerna"],
  ["Acostado pronation con mancuernas", "Pronación de antebrazo acostado con mancuerna"],
  ["Acostado pronation en el suelo con mancuernas", "Pronación de antebrazo acostado en el suelo con mancuerna"],
  ["Acostado single extensión con mancuernas", "Extensión de tríceps acostado a un brazo con mancuerna"],
  ["Acostado supination con mancuernas", "Supinación de antebrazo acostado con mancuerna"],
  ["Acostado supination en el suelo con mancuernas", "Supinación de antebrazo acostado en el suelo con mancuerna"],
  ["Acostado supino curl de bíceps con mancuernas", "Curl de bíceps acostado boca arriba con mancuernas"],
  ["Acostado supino curl con mancuernas", "Curl acostado boca arriba con mancuernas"],
  ["Acostado amplio curl con mancuernas", "Curl de bíceps con brazos separados acostado y mancuernas"],
  ["Un brazo inverso spider curl con mancuernas", "Curl araña inverso a un brazo con mancuerna"],
  ["Un brazo sentado neutral curl de muñeca con mancuernas", "Curl de muñeca sentado a un brazo con agarre neutro y mancuerna"],
  ["Un brazo arrancada con mancuernas", "Arrancada a un brazo con mancuerna"],
  ["Un brazo zottman curl predicador con mancuernas", "Curl Zottman predicador a un brazo con mancuerna"],
  ["Sentado banco extensión con mancuernas", "Extensión de tríceps sentado en banco con mancuernas"],
  ["Sentado neutral curl de muñeca con mancuernas", "Curl de muñeca sentado con agarre neutro y mancuernas"],
  ["Sentado un brazo rotate con mancuernas", "Rotación de antebrazo sentado a un brazo con mancuerna"],
  ["Sentado revers agarre curl de concentración con mancuernas", "Curl de concentración sentado con agarre inverso y mancuernas"],
  ["De pie zottman curl predicador con mancuernas", "Curl Zottman predicador de pie con mancuernas"],
  ["Fitball extensión lumbar con brazos extended", "Extensión lumbar sobre fitball con brazos extendidos"],
  ["Fitball extensión lumbar con hands tras nuca", "Extensión lumbar sobre fitball con manos tras nuca"],
  ["Fitball extensión lumbar con rodillas off ground", "Extensión lumbar sobre fitball con rodillas elevadas"],
  ["Fitball extensión lumbar con rotación", "Extensión lumbar con rotación sobre fitball"],
  ["Fitball fondos", "Fondos sobre fitball"],
  ["Fitball cadera flexor estiramiento", "Estiramiento de flexores de cadera sobre fitball"],
  ["Fitball hug", "Abrazo de fitball"],
  ["Fitball contra la pared elevación de pantorrillas", "Elevación de pantorrillas con fitball contra la pared"],
  ["Fitball contra la pared elevación de pantorrillas (pelota de tenis entre tobillos)", "Elevación de pantorrillas con fitball y pelota entre los tobillos"],
  ["Fitball contra la pared elevación de pantorrillas (pelota de tenis entre rodillas)", "Elevación de pantorrillas con fitball y pelota entre las rodillas"],
  ["Fitball una pierna boca abajo bajar body rotación", "Rotación de tronco boca abajo sobre fitball a una pierna"],
  ["Fitball boca abajo elevación de piernas", "Elevación de piernas boca abajo sobre fitball"],
  ["Fitball sentado isquiotibiales estiramiento", "Estiramiento de isquiotibiales sentado sobre fitball"],
  ["Fitball sentado tríceps estiramiento", "Estiramiento de tríceps sentado sobre fitball"],
  ["Fitball supino extensión de tríceps", "Extensión de tríceps boca arriba sobre fitball"],
  ["Hacia adelante salto", "Salto hacia delante"],
  ["Hacia adelante zancada (hombre)", "Zancada hacia delante"],
  ["Frontal máquina de palanca", "Palanca frontal en máquina"],
  ["Completo maltese", "Maltese completo"],
  ["Completo planche", "Planche completa"],
  ["Planche completo", "Planche completa"],
  ["Alterno hang cargada con kettlebell", "Cargada alterna desde suspensión con kettlebell"],
  ["Rodilla touch encogimiento abdominal", "Encogimiento abdominal tocando las rodillas"],
  ["Pierna arriba isquiotibiales estiramiento", "Estiramiento de isquiotibiales con pierna elevada"],
  ["Máquina de palanca alterno pierna press", "Prensa de piernas alterna en máquina de palanca"],
  ["Máquina de palanca donkey elevación de pantorrillas", "Elevación de pantorrillas tipo burro en máquina de palanca"],
  ["Máquina de palanca gripper hands", "Prensión de manos en máquina de palanca"],
  ["Máquina de palanca hammer agarre curl predicador", "Curl predicador con agarre martillo en máquina de palanca"],
  ["Máquina de palanca horizontal una pierna press", "Prensa horizontal a una pierna en máquina de palanca"],
  ["Máquina de palanca overhand fondos para tríceps", "Fondos de tríceps con agarre prono en máquina de palanca"],
  ["Máquina de palanca inverso hyperextension", "Hiperextensión inversa en máquina de palanca"],
  ["Acostado (lateral) cuádriceps estiramiento", "Estiramiento de cuádriceps acostado de lado"],
  ["Acostado codo a rodilla", "Abdominal de codo a rodilla acostado"],
  ["Acostado pierna-elevación de cadera", "Elevación de cadera con piernas levantadas acostado"],
  ["Supino pecho lanzamiento con balón medicinal", "Lanzamiento de balón medicinal desde el pecho boca arriba"],
  ["Un brazo slam (con medicine balón)", "Lanzamiento de balón medicinal al suelo con un brazo"],
  ["Una pierna donkey elevación de pantorrillas", "Elevación de pantorrillas tipo burro a una pierna"],
  ["Una pierna suelo elevación de pantorrillas", "Elevación de pantorrillas a una pierna en el suelo"],
  ["Sobre la cabeza tríceps estiramiento", "Estiramiento de tríceps sobre la cabeza"],
  ["Posterior paso a sobre la cabeza reach", "Paso atrás con alcance sobre la cabeza"],
  ["Posterior tibialis estiramiento", "Estiramiento del tibial posterior"],
  ["Posterior declinado bridge", "Puente de glúteos declinado"],
  ["Sentado glute estiramiento", "Estiramiento de glúteos sentado"],
  ["Sentado amplio angle pose sequence", "Secuencia de estiramiento sentado con piernas abiertas"],
  ["Lateral bridge cadera abducción", "Abducción de cadera en puente lateral"],
  ["Lateral cadera (en parallel bars)", "Elevación lateral de cadera en paralelas"],
  ["Lateral cadera abducción", "Abducción lateral de cadera"],
  ["Lateral acostado cadera aducción (hombre)", "Aducción de cadera acostado de lado"],
  ["Lateral-a-lateral toque de pies (hombre)", "Toques de pies de lado a lado"],
  ["Una pierna bridge con outstretched pierna", "Puente de glúteos a una pierna con la otra extendida"],
  ["Una pierna platform slide", "Deslizamiento de una pierna sobre plataforma"],
  ["Sled 45 degrees una pierna press", "Prensa de piernas a 45° a una pierna"],
  ["Sled closer sentadilla hack", "Sentadilla hack en trineo con postura cerrada"],
  ["Sled hacia adelante angled elevación de pantorrillas", "Elevación de pantorrillas inclinada hacia delante en trineo"],
  ["Sled acostado sentadilla", "Sentadilla acostado en trineo"],
  ["Smith chair sentadilla", "Sentadilla a silla en máquina Smith"],
  ["Smith completo sentadilla", "Sentadilla completa en máquina Smith"],
  ["Smith pierna press", "Prensa de piernas en máquina Smith"],
  ["Smith sprint zancada", "Zancada de velocista en máquina Smith"],
  ["Smith toe elevación", "Elevación de puntas de pie en máquina Smith"],
  ["De pie pelvic tilt", "Basculación pélvica de pie"],
  ["Banco fondos con lastre", "Fondos en banco con lastre"],
  ["Russian giro con lastre", "Giro ruso con lastre"],
  ["Russian giro (piernas arriba) con lastre", "Giro ruso con piernas elevadas y lastre"],
  ["De pie hand squeeze con lastre", "Prensión de manos de pie con lastre"],
  ["Asistido acostado glúteo y piriformis estiramiento", "Estiramiento asistido de glúteos y piriforme acostado"],
  ["Asistido boca abajo rectus femoris estiramiento", "Estiramiento asistido del recto femoral boca abajo"],
  ["Asistido wheel rueda abdominal con banda elástica", "Rueda abdominal asistida con banda elástica"],
  ["Jack knife abdominal con banda elástica", "Abdominal en navaja con banda elástica"],
  ["Pull through con banda elástica", "Tirón de cadera con banda elástica"],
  ["Pull through en polea con cuerda", "Tirón de cadera en polea con cuerda"],
  ["Elevación de pantorrillas - (band debajo de ambos piernas) v. 2 a dos piernas con banda elástica", "Elevación de pantorrillas con banda elástica bajo ambos pies"],
  ["Completo sentadilla (espalda pov) con barra", "Sentadilla completa con barra (vista posterior)"],
  ["Completo sentadilla (lateral pov) con barra", "Sentadilla completa con barra (vista lateral)"],
  ["Narrow posición sentadilla con barra", "Sentadilla con barra y postura estrecha"],
  ["Bíceps narrow pull-ups", "Dominadas con agarre estrecho para bíceps"],
  ["Bodyweight drop sentadilla con salto", "Sentadilla con salto y caída con peso corporal"],
  ["Bridge - mountain climber (cross body)", "Puente con escalador cruzado"],
  ["High pulley sobre la cabeza extensión de tríceps con polea", "Extensión de tríceps sobre la cabeza en polea alta"],
  ["Cuerda high pulley sobre la cabeza extensión de tríceps con polea", "Extensión de tríceps sobre la cabeza en polea alta con cuerda"],
  ["Squatting curl con polea", "Curl de bíceps en cuclillas con polea"],
  ["De pie inner curl con polea", "Curl de bíceps hacia el interior de pie con polea"],
  ["Calf push estiramiento con hands against wall", "Estiramiento de pantorrillas con manos apoyadas en la pared"],
  ["Calf estiramiento con hands against wall", "Estiramiento de pantorrillas contra la pared"],
  ["Calf estiramiento con cuerda", "Estiramiento de pantorrillas con cuerda"],
  ["Cross body encogimiento abdominal", "Encogimiento abdominal cruzado"],
  ["Cycle cross trainer", "Bicicleta elíptica"],
  ["Curl de bíceps zancada con bowling motion con mancuernas", "Zancada con curl de bíceps y movimiento de bolos con mancuernas"],
  ["Curl de bíceps con stork posición con mancuernas", "Curl de bíceps en equilibrio sobre una pierna con mancuernas"],
  ["Curl de bíceps v sit en bosu balón con mancuernas", "Curl de bíceps sentado en V sobre BOSU con mancuernas"],
  ["Cross body curl martillo con mancuernas", "Curl martillo cruzado con mancuernas"],
  ["Cross body curl martillo v. 2 con mancuernas", "Curl martillo cruzado con mancuernas (variante 2)"],
  ["High curl con mancuernas", "Curl de bíceps alto con mancuernas"],
  ["Inclinado inner curl de bíceps con mancuernas", "Curl de bíceps hacia el interior en banco inclinado con mancuernas"],
  ["Sentado inner curl de bíceps con mancuernas", "Curl de bíceps hacia el interior sentado con mancuernas"],
  ["De pie inner curl de bíceps v. 2 con mancuernas", "Curl de bíceps hacia el interior de pie con mancuernas (variante 2)"],
  ["Sumo pull through con mancuernas", "Tirón de cadera sumo con mancuernas"],
  ["Patada de tríceps con stork posición con mancuernas", "Patada de tríceps en equilibrio sobre una pierna con mancuernas"],
  ["Codo dips", "Fondos apoyados en los codos"],
  ["Fondos apoyado en codos", "Fondos apoyados en los codos"],
  ["Fitball one legged diagonal kick isquiotibiales curl", "Curl femoral diagonal a una pierna sobre fitball"],
  ["Ez barbell jm press de banca", "Press JM con barra EZ"],
  ["High rodilla against wall", "Rodillas altas contra la pared"],
  ["Impossible dips", "Fondos imposibles"],
  ["Inverse curl femoral (en dominada cable máquina)", "Curl femoral inverso en máquina de poleas"],
  ["Iron cross estiramiento", "Estiramiento de cruz de hierro"],
  ["Jack burpee", "Burpee con salto de tijera"],
  ["Jack salto (hombre)", "Salto de tijera"],
  ["Kick out sit", "Patada hacia afuera sentado"],
  ["Pierna pull in flat banco", "Encogimiento de piernas en banco plano"],
  ["Máquina de palanca calf press", "Press de pantorrillas en máquina de palanca"],
  ["Máquina de palanca rotary calf", "Elevación rotatoria de pantorrillas en máquina de palanca"],
  ["Low puente de glúteos en el suelo", "Puente de glúteos bajo en el suelo"],
  ["March sit (wall)", "Marcha en sentadilla isométrica contra la pared"],
  ["Narrow flexión de brazos en fitball", "Flexión de brazos con agarre estrecho sobre fitball"],
  ["Oblique encogimiento abdominal v. 2", "Encogimiento abdominal oblicuo (variante 2)"],
  ["Pull-in (en fitball)", "Encogimiento de rodillas sobre fitball"],
  ["Push a run", "Salida de carrera con empuje"],
  ["Flexión de brazos agarre cerrado off dumbbell", "Flexión de brazos con agarre cerrado apoyado en mancuernas"],
  ["Quick feet v. 2", "Pasos rápidos (variante 2)"],
  ["Ring dips", "Fondos en anillas"],
  ["Run", "Carrera"],
  ["Run (equipment)", "Carrera con equipamiento"],
  ["Sentado calf estiramiento (hombre)", "Estiramiento de pantorrillas sentado"],
  ["Sentado piriformis estiramiento", "Estiramiento del piriforme sentado"],
  ["Short stride run", "Carrera de zancada corta"],
  ["Lateral bridge v. 2", "Puente lateral (variante 2)"],
  ["Lateral muñeca pull estiramiento", "Estiramiento lateral de muñeca con tracción"],
  ["Elevación de pantorrillas (en a dumbbell) a una pierna", "Elevación de pantorrillas a una pierna sobre mancuerna"],
  ["Sled 45° pierna press (lateral pov)", "Prensa de piernas a 45° (vista lateral)"],
  ["Sled 45в° pierna press (espalda pov)", "Prensa de piernas a 45° (vista posterior)"],
  ["Sled calf press en pierna press", "Elevación de pantorrillas en prensa de piernas"],
  ["Sled acostado calf press", "Elevación de pantorrillas acostado en prensa"],
  ["Sled una pierna calf press en pierna press", "Elevación de pantorrillas a una pierna en prensa"],
  ["Smith flexionado rodilla buenos dias", "Buenos días con rodillas flexionadas en máquina Smith"],
  ["Smith low bar sentadilla", "Sentadilla con barra baja en máquina Smith"],
  ["Arrancada pull", "Tirón de arrancada"],
  ["De pie pantorrillas calf estiramiento", "Estiramiento de pantorrillas de pie"],
  ["De pie isquiotibiales y calf estiramiento con strap", "Estiramiento de isquiotibiales y pantorrillas de pie con correa"],
  ["De pie wheel rueda abdominal", "Rueda abdominal de pie"],
  ["Stationary bike run v. 3", "Pedaleo rápido en bicicleta estática (variante 3)"],
  ["Swimmer kicks v. 2 (hombre)", "Patadas de nadador (variante 2)"],
  ["Swing 360", "Balanceo de 360°"],
  ["Three banco fondos", "Fondos entre tres bancos"],
  ["Tríceps dips suelo", "Fondos de tríceps en el suelo"],
  ["Walk elliptical cross trainer", "Caminata en elíptica"],
  ["Walking high rodillas zancada", "Zancadas caminando con rodillas altas"],
  ["Zancada con swing con lastre", "Zancada con balanceo y lastre"],
  ["Russian giro v. 2 con lastre", "Giro ruso con lastre (variante 2)"],
  ["Three banco dips con lastre", "Fondos entre tres bancos con lastre"],
  ["Tríceps dips con lastre", "Fondos de tríceps con lastre"],
  ["Fondos para tríceps en high parallel bars con lastre", "Fondos de tríceps en paralelas altas con lastre"],
  ["Wheel rueda abdominal", "Rueda abdominal"],
  ["Wheel run", "Desplazamiento con rueda abdominal"],
  ["Bíceps curl femoral de concentración", "Curl de bíceps de concentración apoyado en la pierna"],
  ["De pie pantorrillas", "Elevación de pantorrillas de pie"],
  ["Plancha inclinado lateral con peso corporal", "Plancha lateral inclinada con peso corporal"],
  ["Declinado agarre cerrado face press con barra EZ", "Press hacia la cara declinado con barra EZ y agarre cerrado"],
  ["Sentado curls con barra EZ", "Curl de bíceps sentado con barra EZ"],
  ["Sentado calf press en máquina de palanca", "Press de pantorrillas sentado en máquina de palanca"],
  ["Sentado cadera aducción en máquina de palanca", "Aducción de cadera sentado en máquina de palanca"],
  ["Elevación de piernas encogimiento abdominal sentado en máquina de palanca", "Encogimiento abdominal con elevación de piernas sentado en máquina de palanca"],
  ["Sentadilla elevación de pantorrillas en pierna press máquina sentado en máquina de palanca", "Elevación de pantorrillas en prensa de piernas con máquina de palanca"],
  ["Una pierna suelo elevación de pantorrillas en máquina Smith", "Elevación de pantorrillas a una pierna en suelo en máquina Smith"],
  ["De pie espalda curl de muñeca en máquina Smith", "Curl de muñeca detrás de la espalda de pie en máquina Smith"],
  ["De pie pierna elevación de pantorrillas en máquina Smith", "Elevación de pantorrillas de pie en máquina Smith"],
  ["Acostado dos-one curl femoral en máquina de palanca", "Curl femoral acostado: subir con dos piernas y bajar con una en máquina de palanca"],
]);
const EXERCISE_ID_OVERRIDES = new Map([
  ["dataset-hasane-2335", "Press de pantorrillas sentado en máquina de palanca"],
  ["dataset-hasane-0108", "Elevación de pantorrillas de pie con barra y piernas extendidas"],
]);

export const naturalizeExerciseName = (value = "", { group = "", id = "" } = {}) => {
  const original = String(value).trim();
  if (!original) return original;
  const specialNames = [
    [/^Romanian peso muerto\b/i, "Peso muerto rumano"],
    [/^Spider curl\b/i, "Curl araña"],
    [/^High bar sentadilla con barra$/i, "Sentadilla con barra alta"],
    [/^Low bar sentadilla con barra$/i, "Sentadilla con barra baja"],
  ];
  for (const [pattern, replacement] of specialNames) {
    if (pattern.test(original)) return original.replace(pattern, replacement);
  }
  let equipmentSuffix = "";
  let name = original
    .replace(/\btríceps pushdown\b/gi, "extensión de tríceps")
    .replace(/\btríceps extensión de tríceps\b/gi, "extensión de tríceps")
    .replace(/\btricep(?:s)? pushdown\b/gi, "extensión de tríceps")
    .replace(/\btricep(?:s)? kickback\b/gi, "patada de tríceps")
    .replace(/\btricep(?:s)? extensión\b/gi, "extensión de tríceps")
    .replace(/\btricep(?:s)? estiramiento\b/gi, "estiramiento de tríceps")
    .replace(/\bbicep(?:s)? curl\b/gi, "curl de bíceps")
    .replace(/\btricep\b/gi, "tríceps")
    .replace(/\bbicep\b/gi, "bíceps")
    .replace(/\brope attachment\b/gi, "cuerda")
    .replace(/\brope\b/gi, "cuerda")
    .replace(/\bconcentracion\b/gi, "concentración")
    .replace(/\brompecraneos\b/gi, "rompecráneos")
    .replace(/\bcajon\b/gi, "cajón")
    .replace(/\bmaquina\b/gi, "máquina")
    .replace(/\bbalon\b/gi, "balón")
    .replace(/\bmuneca\b/gi, "muñeca");
  const equipmentPrefixes = [
    [/^Ez[- ]?bar(?:bell)?\s+/i, "con barra EZ"],
    [/^Olympic barbell\s+/i, "con barra olímpica"],
    [/^Smith\s+/i, "en máquina Smith"],
    [/^Máquina de palanca\s+/i, "en máquina de palanca"],
    [/^Bodyweight\s+/i, "con peso corporal"],
  ];
  for (const [pattern, equipment] of equipmentPrefixes) {
    const match = name.match(pattern);
    if (!match) continue;
    name = name.slice(match[0].length);
    equipmentSuffix = equipment;
    break;
  }
  if (group === "Tríceps") {
    name = name
      .replace(/\bkickback\b/gi, "patada de tríceps")
      .replace(/\bpushdown\b/gi, "extensión de tríceps");
  }

  const lexicalName = name;
  const modifiers = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const [pattern, replacement] of LEADING_MODIFIERS) {
      const match = name.match(pattern);
      if (!match) continue;
      modifiers.push(replacement);
      name = name.slice(match[0].length).trim();
      changed = true;
      break;
    }
  }
  if (modifiers.length && MOVEMENT_START.test(name)) {
    const equipment = name.match(EQUIPMENT_END)?.[0] || "";
    const movement = equipment ? name.slice(0, -equipment.length) : name;
    name = `${movement} ${modifiers.join(" ")}${equipment}`;
  } else if (modifiers.length) {
    // La acción no se pudo reconocer: conserva el orden original.
    name = lexicalName;
  }
  if (equipmentSuffix && (MOVEMENT_START.test(name) || /^(?:de pie|sentado|acostado|inclinado|declinado|arrodillado|agarre|una pierna|un brazo)\b/i.test(lexicalName))) {
    name = `${name} ${equipmentSuffix}`;
  } else if (equipmentSuffix) {
    name = `${original.replace(/\btricep\b/gi, "tríceps")}`;
  }
  name = name
    .replace(/\bcon agarre (cerrado|amplio|inverso|neutro) con (barra(?: EZ)?|mancuernas|polea)\b/gi, "con $2 y agarre $1")
    .replace(/\bcon piernas (rectas|rígidas) con (barra|mancuernas|banda elástica)\b/gi, "con $2 y piernas $1")
    .replace(/\(con cuerda\) con polea/gi, "en polea con cuerda")
    .replace(/\bBuenos dias\b/g, "Buenos días")
    .replace(/\bJalon\b/g, "Jalón")
    .replace(/\s+/g, " ")
    .replace(/^./, (letter) => letter.toLocaleUpperCase("es"));
  return EXERCISE_ID_OVERRIDES.get(id) || FINAL_NAME_OVERRIDES.get(name) || name;
};

export const naturalizeExerciseNameFully = (value = "", context = {}) => {
  let current = value;
  for (let pass = 0; pass < 4; pass++) {
    const next = naturalizeExerciseName(current, context);
    if (next === current) return next;
    current = next;
  }
  return current;
};
