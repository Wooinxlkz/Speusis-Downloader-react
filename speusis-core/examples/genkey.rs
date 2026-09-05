use speusis_core::license::{generate_key, LicensePlan};

fn main() {
    println!(
        "Lifetime: {}",
        generate_key("Speusis Sample User", "sample@speusis.local", LicensePlan::Lifetime)
    );
    println!(
        "Monthly:  {}",
        generate_key("Speusis Sample User", "sample@speusis.local", LicensePlan::Monthly)
    );
    println!(
        "Trial:    {}",
        generate_key("Speusis Trial User", "trial@speusis.local", LicensePlan::Trial)
    );
}
