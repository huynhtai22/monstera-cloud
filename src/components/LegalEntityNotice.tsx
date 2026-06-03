import { LEGAL_ENTITY, legalEntityStatementEn } from "@/lib/legal-entity";

type LegalEntityNoticeProps = {
    className?: string;
    showContact?: boolean;
};

export function LegalEntityNotice({ className = "", showContact = true }: LegalEntityNoticeProps) {
    return (
        <p className={className}>
            {legalEntityStatementEn}
            {showContact ? (
                <>
                    {" "}
                    Contact:{" "}
                    <a
                        href={`mailto:${LEGAL_ENTITY.contactEmail}`}
                        className="hover:underline"
                    >
                        {LEGAL_ENTITY.contactEmail}
                    </a>
                </>
            ) : null}
        </p>
    );
}
