import { Link } from 'react-router-dom';
import { LogoMark } from '../components/Logo';

export function About() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="flex justify-center">
        <LogoMark className="h-20 w-20" />
      </div>
      <h1 className="mt-6 text-center text-5xl font-black md:text-6xl">Our Story</h1>
      <div className="mt-10 space-y-6 text-xl leading-relaxed text-medical/80">
        <p>
          Flavor Doctors started in a home kitchen with a simple diagnosis:{' '}
          <span className="font-bold text-medical">most food isn't sick — it's just under-treated.</span>
        </p>
        <p>
          So we opened a practice. We doctored mayo until it tasted like ranch dreams. We compounded butter
          with miso, gochujang, truffle, and blueberry-lavender until steaks and toast alike begged for
          appointments. We reverse-engineered the great drive-thru sauces and wrote them into the permanent
          medical record.
        </p>
        <p>
          Every jar, roll, and shaker is made in small batches with real ingredients — then labeled like the
          prescription it is. Because when flavor is the cure, dosage matters.
        </p>
        <div className="prescription-pad !text-navy">
          <p className="font-heading text-2xl font-black">Our Oath</p>
          <p className="mt-3 font-heading text-lg italic">
            "First, do no bland. Second, apply liberally. Third, always leave the pantry better than we
            found it."
          </p>
          <p className="mt-4 text-right font-heading text-xl italic text-rx-dark">— Dr. Flavor, MD</p>
        </div>
        <p className="text-center">
          <Link to="/menu" className="btn-rx mt-4">
            Book an Appointment (Browse the Menu)
          </Link>
        </p>
      </div>
    </div>
  );
}
