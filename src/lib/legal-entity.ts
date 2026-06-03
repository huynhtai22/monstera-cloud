export const LEGAL_ENTITY = {
    legalName: "Hộ kinh doanh MONSTERA GROUP",
    registrationNumber: "56L8019299",
    country: "Vietnam",
    contactEmail: "huynhtai@monsteracloud.com",
} as const;

export const legalEntityStatementEn =
    `Monstera Cloud is operated by ${LEGAL_ENTITY.legalName}, registered in ${LEGAL_ENTITY.country} (Mã số đăng ký: ${LEGAL_ENTITY.registrationNumber}).`;

export const legalEntityStatementVi =
    `Monstera Cloud được vận hành bởi ${LEGAL_ENTITY.legalName}, đăng ký tại Việt Nam (Mã số đăng ký: ${LEGAL_ENTITY.registrationNumber}).`;
