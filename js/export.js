(function () {
  function downloadLeadsCsv(leads, filename = "openscout-leads.csv") {
    const headers = [
      "Business Name",
      "Lead Type",
      "Confidence %",
      "Web Status",
      "Address",
      "Phone",
      "Rating",
      "Review Count",
      "Existing Link",
      "Business Status",
      "Latitude",
      "Longitude",
      "Google Maps URL",
    ];
    const rows = leads.map((lead) => [
      lead.name,
      lead.leadType || "No website",
      lead.confidence ?? "",
      webStatus(lead),
      lead.address,
      lead.phone,
      lead.rating,
      lead.ratingCount,
      lead.weakLink || "",
      lead.businessStatus || "",
      lead.lat ?? "",
      lead.lng ?? "",
      lead.googleMapsURL,
    ]);
    const csv = [headers, ...rows].map(toCsvRow).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function webStatus(lead) {
    if (lead.verification === "dead") return "Listed site offline";
    if (lead.verification === "live") return "Listed site live";
    if (lead.leadCategory === "none" || lead.leadTier === "none") return "No website found";
    return lead.leadType || "";
  }

  function toCsvRow(row) {
    return row
      .map((value) => {
        const text = String(value ?? "");
        const escaped = text.replaceAll('"', '""');
        return `"${escaped}"`;
      })
      .join(",");
  }

  window.OpenScout = window.OpenScout || {};
  window.OpenScout.exporter = {
    downloadLeadsCsv,
  };
})();
