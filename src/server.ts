// Server para correr LOCAL (npm run dev / npm start). En Vercel no se usa este
// archivo — ahí la entrada es api/index.ts, que reutiliza la misma app.
import { app } from "./app.js";

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`DigiPlayers API escuchando en :${port}`));
