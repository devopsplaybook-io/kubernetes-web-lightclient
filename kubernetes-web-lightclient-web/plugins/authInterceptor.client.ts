import axios from "axios";
import { handleSessionExpiryError } from "~~/services/SessionExpiry";

// Every component calls the global axios instance directly, so a single
// response interceptor here covers the whole app. 401s from the manual
// login endpoint are skipped: a wrong password there must keep showing its
// credential error. Renewal failures (/users/session/refresh) are covered.
export default defineNuxtPlugin(() => {
  const router = useRouter();
  const route = useRoute();
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      const requestUrl: string = error?.config?.url ?? "";
      if (
        axios.isAxiosError(error) &&
        error.response?.status === 401 &&
        !requestUrl.endsWith("/users/session")
      ) {
        return handleSessionExpiryError(error, { router, currentRoute: route }).then(
          () => Promise.reject(error),
        );
      }
      return Promise.reject(error);
    },
  );
});
