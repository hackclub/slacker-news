import type { APIRoute } from "astro";
import { getAuth } from "../../../lib/auth";

export const ALL: APIRoute = ({ request }) => getAuth().handler(request);
