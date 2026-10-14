import type { BindPhoneInput, PhoneBindingResult } from "@paiyouju/shared";

import { postJson } from "./client.js";

export const bindPhone = (input: BindPhoneInput) => postJson<PhoneBindingResult>("/api/account/phone", input);
